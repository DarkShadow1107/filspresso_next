using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Filspresso.Core.Api;

/// <summary>
/// Everything the application needs to draw itself, from one call.
/// </summary>
/// <remarks>
/// One endpoint rather than the four it replaces, because the app polls this after every
/// generation and four round trips per poll is four chances to draw an inconsistent screen.
/// <para>
/// <see cref="CanGenerate"/> is not derivable from the allowance and the wallet on their
/// own: it is true when <em>either</em> pot can pay. An account with no allowance left and a
/// funded wallet may still generate, and a client that checked the allowance alone would
/// lock paying customers out of a Playground they can use.
/// </para>
/// </remarks>
public sealed record Entitlement
{
    [JsonPropertyName("accountId")]
    public long AccountId { get; init; }

    [JsonPropertyName("tier")]
    public string Tier { get; init; } = "free";

    [JsonPropertyName("access")]
    public SpectreAccess Access { get; init; } = new();

    /// <summary>
    /// Whether the account's <em>plan</em> includes the Playground, which is a different
    /// question from <see cref="SpectreAccess.Source"/>. The first decides whether to offer
    /// the subscription at all; the second explains where a given message is being charged
    /// from. They usually agree, and where they differ the difference is the whole story.
    /// </summary>
    [JsonPropertyName("tierGrantsAccess")]
    public bool TierGrantsAccess { get; init; }

    [JsonPropertyName("allowance")]
    public AllowanceView Allowance { get; init; } = new();

    [JsonPropertyName("wallet")]
    public WalletView Wallet { get; init; } = new();

    [JsonPropertyName("canGenerate")]
    public bool CanGenerate { get; init; }

    [JsonPropertyName("subscription")]
    public SubscriptionTerms Subscription { get; init; } = new();

    [JsonPropertyName("models")]
    public IReadOnlyList<ModelEntry> Models { get; init; } = Array.Empty<ModelEntry>();

    [JsonPropertyName("servedAt")]
    public DateTimeOffset ServedAt { get; init; }

    /// <summary>
    /// Whether the app may send anything at all. A locked account still gets a full
    /// catalogue with prices, because the screen's job is to show what exists and what it
    /// would cost.
    /// </summary>
    public bool HasAccess => Access.HasAccess;
}

public sealed record SpectreAccess
{
    [JsonPropertyName("hasAccess")]
    public bool HasAccess { get; init; }

    /// <summary>"tier", "addon", or null.</summary>
    [JsonPropertyName("source")]
    public string? Source { get; init; }

    [JsonPropertyName("expiresAt")]
    public DateTimeOffset? ExpiresAt { get; init; }

    [JsonPropertyName("autoRenew")]
    public bool AutoRenew { get; init; }

    [JsonPropertyName("canFundWallet")]
    public bool CanFundWallet { get; init; }
}

public sealed record AllowanceView
{
    [JsonPropertyName("grantedRon")]
    public decimal GrantedRon { get; init; }

    [JsonPropertyName("spentRon")]
    public decimal SpentRon { get; init; }

    [JsonPropertyName("remainingRon")]
    public decimal RemainingRon { get; init; }

    [JsonPropertyName("resetAt")]
    public DateTimeOffset? ResetAt { get; init; }
}

public sealed record WalletView
{
    [JsonPropertyName("balanceRon")]
    public decimal BalanceRon { get; init; }

    /// <summary>False once the balance is at or below the account's own floor.</summary>
    [JsonPropertyName("canGenerate")]
    public bool CanGenerate { get; init; }

    [JsonPropertyName("minBalanceRon")]
    public decimal MinBalanceRon { get; init; }

    [JsonPropertyName("minBalanceIsCustom")]
    public bool MinBalanceIsCustom { get; init; }

    [JsonPropertyName("autoRefill")]
    public AutoRefillView AutoRefill { get; init; } = new();
}

public sealed record AutoRefillView
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; init; }

    [JsonPropertyName("targetRon")]
    public decimal TargetRon { get; init; }

    [JsonPropertyName("reason")]
    public string? Reason { get; init; }
}

public sealed record SubscriptionTerms
{
    [JsonPropertyName("monthlyRon")]
    public decimal MonthlyRon { get; init; }

    [JsonPropertyName("annualRon")]
    public decimal AnnualRon { get; init; }

    /// <summary>
    /// Always false today. It is carried through rather than hardcoded so that if the product
    /// ever bundles usage, the client starts showing the truth instead of continuing to
    /// promise a subscription that does not include tokens.
    /// </summary>
    [JsonPropertyName("includesUsage")]
    public bool IncludesUsage { get; init; }
}

public sealed record ModelEntry
{
    [JsonPropertyName("modelKey")]
    public string ModelKey { get; init; } = string.Empty;

    [JsonPropertyName("inputPer1M")]
    public decimal InputPer1M { get; init; }

    [JsonPropertyName("outputPer1M")]
    public decimal OutputPer1M { get; init; }

    [JsonPropertyName("priceMode")]
    public string PriceMode { get; init; } = "playground";

    [JsonPropertyName("locked")]
    public bool Locked { get; init; }

    [JsonPropertyName("usesAllowance")]
    public bool UsesAllowance { get; init; }

    /// <summary>
    /// A hint for the UI, never a gate. The balance was read when the screen was drawn and
    /// says nothing about the balance at send time, so the gateway re-checks on every
    /// request.
    /// </summary>
    [JsonPropertyName("requiresWallet")]
    public bool RequiresWallet { get; init; }
}