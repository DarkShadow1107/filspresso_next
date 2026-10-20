using System;
using System.Collections.Generic;
using System.Linq;
using Filspresso.Core.Api;

namespace Filspresso.Core.Session;

/// <summary>
/// Whether the Playground can be used, and if not, why not.
/// </summary>
/// <remarks>
/// This is a state and not an error, and the difference is the whole point of the type.
/// <para>
/// A 402 means the account has spent its allowance and its wallet is empty. A 503 means
/// <em>we</em> could not find out. A 403 means the subscription lapsed. They are three
/// different situations with three different things a user can do about them, and a client
/// that reports all of them as "something went wrong" has told the user nothing and made them
/// guess.
/// </para>
/// <para>
/// So the mapping from a transport error to a state happens here, once, and the UI renders a
/// state rather than reacting to a status code. The wording belongs to the UI — the state
/// carries the fact, not the sentence.
/// </para>
/// </remarks>
public enum PlaygroundAvailability
{
    /// <summary>Nothing has been loaded yet. The screen shows nothing rather than guessing.</summary>
    Unknown = 0,

    /// <summary>Usable.</summary>
    Ready,

    /// <summary>
    /// The session is gone. The only thing that helps is signing in again.
    /// </summary>
    SignedOut,

    /// <summary>
    /// No Spectre access: the subscription lapsed, or was never there.
    /// </summary>
    NoAccess,

    /// <summary>
    /// Genuinely out of money. The allowance is spent and the wallet is empty.
    /// </summary>
    OutOfFunds,

    /// <summary>
    /// The billing service could not be reached, so we do not know whether this is affordable.
    /// </summary>
    /// <remarks>
    /// Deliberately distinct from <see cref="OutOfFunds"/>. Answering "out of funds" to a
    /// billing outage would send a paying customer to top up a wallet that is not the problem,
    /// and would make the outage look like a business event rather than an incident.
    /// </remarks>
    BillingUnavailable,

    /// <summary>
    /// The model is loading, or its single slot is busy. Retryable, and nothing to do with
    /// money.
    /// </summary>
    /// <remarks>
    /// Its own state, and not folded into <see cref="ModelUnavailable"/>. The model service
    /// holds one llama.cpp slot, and loading a different model takes minutes. Telling the user
    /// "the model service failed" while it is in fact loading the model they asked for is
    /// both wrong and the more alarming of the two.
    /// </remarks>
    ModelBusy,

    /// <summary>The model service failed. The money is fine; the generation is not.</summary>
    ModelUnavailable,

    /// <summary>Too many requests in a short window. Waiting helps.</summary>
    RateLimited,

    /// <summary>The network or the server could not be reached at all.</summary>
    Unreachable,
}

public static class PlaygroundAvailabilityExtensions
{
    /// <summary>
    /// What this state means for whether a message can be sent.
    /// </summary>
    /// <remarks>
    /// Only <see cref="PlaygroundAvailability.Ready"/> allows a send. Unknown does not: the
    /// pre-flight has to have run and said yes, and letting an unverified state through is
    /// how a locked account ends up sending.
    /// </remarks>
    public static bool AllowsSending(this PlaygroundAvailability availability) =>
        availability == PlaygroundAvailability.Ready;

    /// <summary>Whether the user needs to do something before this becomes Ready again.</summary>
    public static bool NeedsUserAction(this PlaygroundAvailability availability) => availability is
        PlaygroundAvailability.SignedOut or
        PlaygroundAvailability.NoAccess or
        PlaygroundAvailability.OutOfFunds;

    /// <summary>
    /// Maps a transport error onto a state.
    /// </summary>
    /// <remarks>
    /// The one rule worth stating: 402 and 503 must never land on the same value. They look
    /// alike from the outside and mean opposite things to the user.
    /// </remarks>
    public static PlaygroundAvailability From(ApiError error) => error switch
    {
        ApiError.None => PlaygroundAvailability.Ready,
        ApiError.Unauthenticated => PlaygroundAvailability.SignedOut,
        ApiError.Locked => PlaygroundAvailability.NoAccess,
        ApiError.OutOfFunds => PlaygroundAvailability.OutOfFunds,
        ApiError.BillingUnavailable => PlaygroundAvailability.BillingUnavailable,
        ApiError.ModelBusy => PlaygroundAvailability.ModelBusy,
        ApiError.Upstream => PlaygroundAvailability.ModelUnavailable,
        ApiError.RateLimited => PlaygroundAvailability.RateLimited,
        _ => PlaygroundAvailability.Unreachable,
    };
}

/// <summary>How one model may be used right now.</summary>
public enum ModelAvailability
{
    /// <summary>Usable, and drawn from the monthly allowance.</summary>
    Included,

    /// <summary>
    /// Usable, but paid for from the wallet.
    /// </summary>
    /// <remarks>
    /// A distinct state rather than a variant of <see cref="Included"/>, because the user is
    /// being charged differently for it. An 8B on a Max plan runs, and comes out of the
    /// wallet; showing it as simply "available" would hide the fact that it costs real money
    /// on a plan that is supposed to be covered.
    /// </remarks>
    WalletOnly,

    /// <summary>Not usable at all: the account has no Playground access.</summary>
    Locked,
}

public sealed record ModelView(
    string ModelKey,
    string Label,
    decimal InputPer1M,
    decimal OutputPer1M,
    ModelAvailability Availability,
    bool CanGenerate)
{
    /// <summary>Whether a message can be sent with this model at all.</summary>
    public bool IsUsable => Availability != ModelAvailability.Locked;

    /// <summary>
    /// What a message of this size would cost, as an estimate.
    /// </summary>
    /// <remarks>
    /// An estimate, and the UI says so. The server charges from its own token counts; this
    /// projects from the token counts it reported back, so it is the same arithmetic with a
    /// rounding difference. It is shown to help a user choose a model, not to settle a bill.
    /// </remarks>
    public decimal EstimateCost(int inputTokens, int outputTokens) =>
        Math.Max(0, inputTokens) / 1_000_000m * InputPer1M +
        Math.Max(0, outputTokens) / 1_000_000m * OutputPer1M;
}

/// <summary>
/// The models on offer, as the application should present them.
/// </summary>
/// <remarks>
/// Derived from one entitlement response rather than assembled from two calls. The prices
/// come from the same resolved price the server charges with, so a model cannot be quoted at
/// one number and billed at another — which is the failure that a "catalogue from the public
/// pricing endpoint, lock state from entitlement" split invites, because the two are fetched
/// at different moments and can disagree.
/// </remarks>
public sealed class ModelCatalogue
{
    public ModelCatalogue(Entitlement entitlement)
    {
        ArgumentNullException.ThrowIfNull(entitlement);

        Models = (entitlement.Models ?? Array.Empty<ModelEntry>())
            .Select(m => new ModelView(
                m.ModelKey,
                // Falls back to the key when the server sends no label, which is ugly but
                // honest; inventing a nicer name here would drift from the server's.
                string.IsNullOrWhiteSpace(m.Label) ? m.ModelKey : m.Label,
                m.InputPer1M,
                m.OutputPer1M,
                !entitlement.HasAccess || m.Locked
                    ? ModelAvailability.Locked
                    : m.UsesAllowance
                        ? ModelAvailability.Included
                        : ModelAvailability.WalletOnly,
                entitlement.HasAccess && !m.Locked && m.CanGenerate))
            .ToArray();
    }

    public IReadOnlyList<ModelView> Models { get; }

    public IEnumerable<ModelView> Usable => Models.Where(m => m.IsUsable);

    public IEnumerable<ModelView> Locked => Models.Where(m => !m.IsUsable);

    /// <summary>
    /// The model to start with: the cheapest one that can actually be paid for.
    /// </summary>
    /// <remarks>
    /// The cheapest *affordable* one, deliberately. Defaulting to the most capable model
    /// would silently pick a wallet-only 8B on a Max plan, and the first message would be
    /// refused for money the user did not know they were being asked to spend.
    /// </remarks>
    public ModelView? DefaultModel =>
        Usable.Where(m => m.CanGenerate).OrderBy(m => m.InputPer1M).FirstOrDefault()
        ?? Usable.OrderBy(m => m.InputPer1M).FirstOrDefault();
}
