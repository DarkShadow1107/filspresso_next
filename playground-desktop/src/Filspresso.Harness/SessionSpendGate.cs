using System;
using System.Collections.Generic;
using System.Linq;
using Filspresso.Core.Api;
using Filspresso.Core.Session;
using Filspresso.Core.Streaming;

namespace Filspresso.Harness;

/// <summary>
/// An optional, client-side ceiling on what one conversation may spend.
/// </summary>
/// <remarks>
/// EXPERIMENTAL, and deliberately unreachable unless the user switched it on: a null cap is
/// "off" everywhere it is read, no default value pretends otherwise. The estimate comes from
/// the usage the server reported for each completed reply and the per-model prices the
/// entitlement resolved, so it is the same arithmetic the server charges with at whatever
/// rounding difference two independent token counts produce.
/// <para>
/// Two properties are not negotiable. The gate never blocks a reply that was already
/// delivered — the cost is paid either way, and refusing to show the answer helps nobody.
/// And it fails closed on an unknown price: a reply from a model this device cannot price
/// makes the ceiling unverifiable, so the gate treats it as reached rather than falling
/// open and letting an unbounded model spend anyway.
/// </para>
/// </remarks>
public interface ISessionSpendGate
{
    /// <summary>Called once per completed model reply, before that reply's tool batch is executed.</summary>
    void Record(string modelKey, TokenUsage replyUsage);

    /// <summary>Whether the recorded spend has reached its ceiling, or a price could not be verified.</summary>
    bool Reached { get; }

    /// <summary>
    /// Starts a fresh budget for a new conversation: the accumulated total is cleared, the
    /// ceiling itself is unchanged. The cap is per conversation by design, so dropping the
    /// history is also what re-arms the allowance -- and the label in settings says so.
    /// </summary>
    void Reset();
}

/// <summary>The only implementation of <see cref="ISessionSpendGate"/>. Per conversation, never shared.</summary>
public sealed class SessionSpendGate : ISessionSpendGate
{
    private readonly object _lock = new();
    private readonly Func<string, (decimal InputPer1M, decimal OutputPer1M)?> _pricing;
    private decimal _spend;
    private bool _unpriced;

    /// <summary>The ceiling in RON, or null when the gate is off. Read, never mutated.</summary>
    public decimal? CapRon { get; }

    public SessionSpendGate(decimal? capRon, Func<string, (decimal InputPer1M, decimal OutputPer1M)?> pricing)
    {
        ArgumentNullException.ThrowIfNull(pricing);
        _pricing = pricing;
        CapRon = capRon is { } cap && cap > 0 ? cap : null;
    }

    /// <summary>Whether the gate could be reached at all. A null cap is off; the record call is then inert.</summary>
    public bool Enabled => CapRon is { } cap && cap > 0;

    /// <summary>Estimated spend recorded so far. Zero while off.</summary>
    public decimal RecordedSpendRon
    {
        get { lock (_lock) return _spend; }
    }

    public bool Reached
    {
        get { lock (_lock) return CapRon is { } cap && (_unpriced || _spend >= cap); }
    }

    /// <summary>
    /// Starts a fresh conversation budget: the accrual and any unverifiable-price mark are
    /// cleared. The ceiling is read-only and unchanged, and a null (off) gate stays inert.
    /// </summary>
    public void Reset()
    {
        lock (_lock) { _spend = 0; _unpriced = false; }
    }

    /// <summary>
    /// Adds one completed reply's cost to the record. Zero-token replies add nothing;
    /// an unknown model marks the ceiling unverifiable.
    /// </summary>
    public void Record(string modelKey, TokenUsage usage)
    {
        if (!Enabled || usage.IsEmpty) return;
        var price = _pricing(modelKey ?? string.Empty);
        lock (_lock)
        {
            if (price is not { } rates)
            {
                _unpriced = true;
                return;
            }
            _spend += Math.Max(0, usage.InputTokens) / 1_000_000m * rates.InputPer1M +
                      Math.Max(0, usage.OutputTokens) / 1_000_000m * rates.OutputPer1M;
        }
    }

    /// <summary>
    /// A gate over the models the account can currently use, or null when the preference is
    /// off (which is the default).
    /// </summary>
    /// <remarks>
    /// Built from the entitlement's own resolved prices, so a model cannot be estimated at
    /// one rate here and charged at another on the server. The lookup answers null for any
    /// key the catalogue does not hold, which the gate reads as "unverifiable" and stops.
    /// </remarks>
    public static SessionSpendGate? Create(decimal? capRon, Entitlement? entitlement)
    {
        if (capRon is not { } ceiling || ceiling <= 0) return null;
        var models = entitlement?.Models ?? Array.Empty<ModelEntry>();
        var byKey = models.Where(m => !string.IsNullOrWhiteSpace(m.ModelKey))
            .ToDictionary(m => m.ModelKey, m => (m.InputPer1M, m.OutputPer1M), StringComparer.Ordinal);
        Func<string, (decimal InputPer1M, decimal OutputPer1M)?> resolve =
            key => byKey.TryGetValue(key, out var price) ? price : null;
        return new SessionSpendGate(ceiling, resolve);
    }

    /// <summary>What the user sees when the gate is shown in settings or the status line.</summary>
    public string? Describe() => CapRon is { } cap
        ? $"session spend cap ~{cap:0.##} RON (experimental, off by default, client-side estimate)"
        : null;
}
