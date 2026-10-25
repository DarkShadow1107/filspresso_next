using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Filspresso.Core.Streaming;

namespace Filspresso.Core.Session;

/// <summary>What a completed message cost, as the client can tell.</summary>
public sealed record MessageUsage(int InputTokens, int OutputTokens, decimal? EstimatedCostRon);

/// <summary>One step of a message being sent.</summary>
public abstract record PlaygroundEvent
{
    public sealed record Context(ContextState State) : PlaygroundEvent;
    /// <summary>A piece of the answer.</summary>
    public sealed record Say(string Text) : PlaygroundEvent;

    public sealed record Think(string Text) : PlaygroundEvent;

    /// <summary>The message finished. Carries what it cost, as an estimate.</summary>
    public sealed record Finished(MessageUsage Usage) : PlaygroundEvent;

    /// <summary>
    /// The message stopped, and here is the state it stopped in.
    /// </summary>
    /// <remarks>
    /// A state rather than an error, because there is nothing the user can debug. It is the
    /// same <see cref="PlaygroundAvailability"/> the screen shows when the page loads, so a
    /// failure mid-session and a failure on arrival read the same way.
    /// </remarks>
    public sealed record Stopped(PlaygroundAvailability Availability) : PlaygroundEvent;
}

/// <summary>
/// Drives one Playground session: what may be sent, sending it, and staying current.
/// </summary>
/// <remarks>
/// The two rules this exists to enforce:
/// <para>
/// <b>Pre-flight before every message.</b> The screen's idea of the balance was true when it
/// was drawn and may not be true now, so a message is checked against freshly loaded state
/// rather than against a cached number. The server checks again — this is a courtesy that
/// saves the user a failed round trip, not a control.
/// </para>
/// <para>
/// <b>Refresh after every generation.</b> A message spends money. Leaving the balance stale
/// after one is how a user runs three messages and is then surprised that the fourth is
/// refused, having been told they had plenty.
/// </para>
/// </remarks>
public sealed class PlaygroundSession
{
    private readonly DesktopApiClient _api;
    private readonly IAuthSession _auth;
    private readonly Func<CancellationToken, Task<ApiResult<Entitlement>>> _loadEntitlement;
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private int _sending;
    private int _generation;

    public PlaygroundSession(
        DesktopApiClient api,
        IAuthSession auth,
        Func<CancellationToken, Task<ApiResult<Entitlement>>> loadEntitlement)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(auth);
        ArgumentNullException.ThrowIfNull(loadEntitlement);

        _api = api;
        _auth = auth;
        _loadEntitlement = loadEntitlement;
    }

    /// <summary>The last entitlement that was loaded, or null before the first one.</summary>
    public Entitlement? Entitlement { get; private set; }

    /// <summary>The state as of the last load.</summary>
    public PlaygroundAvailability Availability { get; private set; } = PlaygroundAvailability.Unknown;

    /// <summary>Whether a generation is in flight.</summary>
    public bool IsSending => Volatile.Read(ref _sending) != 0;

    /// <summary>Raised whenever the state changes, so the UI can re-render.</summary>
    public event EventHandler? Changed;

    /// <summary>The models on offer, as of the last load.</summary>
    public ModelCatalogue Catalogue => new(Entitlement ?? new Entitlement());

    /// <summary>
    /// Loads the current state.
    /// </summary>
    /// <remarks>
    /// Called on arrival, on window focus, and after every generation. The result decides
    /// whether the screen shows a lock, a top-up prompt, or a working input box.
    /// </remarks>
    public async Task<PlaygroundAvailability> RefreshAsync(CancellationToken cancellationToken = default)
    {
        await _refreshGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            // The generation counter, so a refresh that started before a sign-out does not
            // publish a stale answer over the signed-out state.
            var generation = Volatile.Read(ref _generation);
            var result = await _loadEntitlement(cancellationToken).ConfigureAwait(false);

            if (generation != Volatile.Read(ref _generation))
            {
                return Availability;
            }

            if (!result.Ok || result.Value is null)
            {
                Entitlement = null;
                SetAvailability(result.Ok
                    ? PlaygroundAvailability.Unreachable
                    : PlaygroundAvailabilityExtensions.From(result.Error));
            }
            else
            {
                Entitlement = result.Value;
                SetAvailability(!result.Value.HasAccess
                    ? PlaygroundAvailability.NoAccess
                    : result.Value.CanGenerate
                        ? PlaygroundAvailability.Ready
                        : PlaygroundAvailability.OutOfFunds);
            }

            return Availability;
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    /// <summary>
    /// Whether this particular model may be used, and may be paid for.
    /// </summary>
    /// <remarks>
    /// Separate from the account-level state, because they answer different questions. An
    /// account can be perfectly able to generate and still be unable to run the model that
    /// was selected -- the 8B on a Max plan is the case, because it is paid from the
    /// wallet and the wallet may be empty. The screen has to say which of the two it is.
    /// </remarks>
    public PlaygroundAvailability ForModel(string? modelKey)
    {
        if (Availability != PlaygroundAvailability.Ready)
        {
            return Availability;
        }

        var model = Catalogue.Models.FirstOrDefault(m => m.ModelKey == modelKey);
        if (model is null)
        {
            return PlaygroundAvailability.ModelUnavailable;
        }

        if (!model.IsUsable)
        {
            return PlaygroundAvailability.NoAccess;
        }

        return model.CanGenerate ? PlaygroundAvailability.Ready : PlaygroundAvailability.OutOfFunds;
    }

    /// <summary>
    /// Sends a message.
    /// </summary>
    /// <remarks>
    /// The pre-flight is a refresh, not a read of what is already loaded. It costs one call
    /// and it is the difference between "your wallet is empty" and a failed request the user
    /// did not see coming.
    /// </remarks>
    public async IAsyncEnumerable<PlaygroundEvent> SendAsync(
        string prompt,
        string modelKey,
        double temperature = 0.7,
        int maxTokens = 2048,
        bool thinking = false,
        int inputContextTokens = 16_384,
        IReadOnlyList<PreparedSource>? contexts = null,
        IReadOnlyList<ChatTurn>? history = null,
        string compactionMode = "balanced",
        bool compactNow = false,
        string? sessionUuid = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prompt);
        ArgumentException.ThrowIfNullOrWhiteSpace(modelKey);

        // One generation at a time. Two concurrent streams would interleave their text in one
        // transcript, and the second would be billed while the user could not tell which
        // words belonged to which answer.
        if (Interlocked.CompareExchange(ref _sending, 1, 0) != 0)
        {
            throw new InvalidOperationException("A generation is already running.");
        }

        try
        {
            await RefreshAsync(cancellationToken).ConfigureAwait(false);

            var available = ForModel(modelKey);
            if (!available.AllowsSending())
            {
                yield return new PlaygroundEvent.Stopped(available);
                yield break;
            }

            if (!await _auth.EnsureAccessTokenAsync(cancellationToken).ConfigureAwait(false) ||
                _auth.Current is null)
            {
                SetAvailability(PlaygroundAvailability.SignedOut);
                yield return new PlaygroundEvent.Stopped(Availability);
                yield break;
            }

            var selected = Catalogue.Models.First(m => m.ModelKey == modelKey);
            StreamUpdate.Completed? completion = null;

            await foreach (var update in _api
                .StreamChatAsync(_auth.Current.AccessToken, modelKey, prompt, null, temperature, maxTokens, thinking,
                    inputContextTokens, contexts, history, compactionMode, compactNow, sessionUuid, cancellationToken)
                .ConfigureAwait(false))
            {
                switch (update)
                {
                    case StreamUpdate.Context context:
                        yield return new PlaygroundEvent.Context(context.State);
                        break;
                    case StreamUpdate.Delta delta:
                        yield return new PlaygroundEvent.Say(delta.Text);
                        break;

                    case StreamUpdate.Reasoning reasoning:
                        yield return new PlaygroundEvent.Think(reasoning.Text);
                        break;

                    case StreamUpdate.Completed done:
                        completion = done;
                        break;

                    case StreamUpdate.Refused refused:
                        // The state is set from the error, and the screen shows the same thing
                        // it would show if the page had loaded in that state.
                        SetAvailability(PlaygroundAvailabilityExtensions.From(refused.Error));
                        yield return new PlaygroundEvent.Stopped(Availability);
                        yield break;
                }
            }

            if (completion is null)
            {
                // The stream ended without a done frame: the model did not finish, so there is
                // no usage to bill and no answer to present as complete.
                SetAvailability(PlaygroundAvailability.ModelUnavailable);
                yield return new PlaygroundEvent.Stopped(Availability);
                yield break;
            }

            // Refreshed before the completion is published, so even a caller that stops
            // reading at the completion still has the settled balance.
            await RefreshAsync(cancellationToken).ConfigureAwait(false);

            yield return new PlaygroundEvent.Finished(new MessageUsage(
                completion.Usage.InputTokens,
                completion.Usage.OutputTokens,
                completion.UsageReported
                    ? selected.EstimateCost(completion.Usage.InputTokens, completion.Usage.OutputTokens)
                    : null));
        }
        finally
        {
            Interlocked.Exchange(ref _sending, 0);
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private void SetAvailability(PlaygroundAvailability value)
    {
        Availability = value;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Forgets the account state, for when the session ends.
    /// </summary>
    /// <remarks>
    /// The generation counter is bumped so a refresh already in flight cannot publish a
    /// balance for an account the user has just left.
    /// </remarks>
    public void Reset()
    {
        Interlocked.Increment(ref _generation);
        Entitlement = null;
        SetAvailability(PlaygroundAvailability.SignedOut);
    }
}
