using System;
using System.Linq;
using Filspresso.Core.Api;
using Filspresso.Core.Session;
using Xunit;

namespace Filspresso.Core.Tests;

public class PlaygroundAvailabilityTests
{
    /// <summary>
    /// The single most important rule in this file.
    /// </summary>
    /// <remarks>
    /// 402 and 503 look alike from outside and mean opposite things to the user. 402 is "you
    /// have run out"; 503 is "we could not check". Answering "out of funds" to a billing
    /// outage sends a paying customer to top up a wallet that is not the problem, and turns an
    /// incident into what looks like a business event.
    /// </remarks>
    [Fact]
    public void OutOfFundsAndBillingUnavailableAreNeverTheSameState()
    {
        Assert.NotEqual(
            PlaygroundAvailabilityExtensions.From(ApiError.OutOfFunds),
            PlaygroundAvailabilityExtensions.From(ApiError.BillingUnavailable));
    }

    [Theory]
    [InlineData(ApiError.Unauthenticated, PlaygroundAvailability.SignedOut)]
    [InlineData(ApiError.Locked, PlaygroundAvailability.NoAccess)]
    [InlineData(ApiError.OutOfFunds, PlaygroundAvailability.OutOfFunds)]
    [InlineData(ApiError.BillingUnavailable, PlaygroundAvailability.BillingUnavailable)]
    [InlineData(ApiError.Upstream, PlaygroundAvailability.ModelUnavailable)]
    [InlineData(ApiError.RateLimited, PlaygroundAvailability.RateLimited)]
    [InlineData(ApiError.Unexpected, PlaygroundAvailability.Unreachable)]
    public void EveryTransportErrorLandsOnItsOwnState(ApiError error, PlaygroundAvailability expected) =>
        Assert.Equal(expected, PlaygroundAvailabilityExtensions.From(error));

    [Fact]
    public void OnlyVerifiedReadyAllowsSending()
    {
        // Unknown does NOT allow a send. The pre-flight has to have run and said yes:
        // letting an unverified state through is how a locked account ends up sending.
        Assert.False(PlaygroundAvailability.Unknown.AllowsSending());
        Assert.True(PlaygroundAvailability.Ready.AllowsSending());

        foreach (var state in new[]
                 {
                     PlaygroundAvailability.SignedOut,
                     PlaygroundAvailability.NoAccess,
                     PlaygroundAvailability.OutOfFunds,
                     PlaygroundAvailability.BillingUnavailable,
                     PlaygroundAvailability.ModelUnavailable,
                     PlaygroundAvailability.RateLimited,
                     PlaygroundAvailability.Unreachable,
                 })
        {
            Assert.False(state.AllowsSending(), $"{state} must not allow sending");
        }
    }

    [Theory]
    [InlineData(PlaygroundAvailability.SignedOut, true)]
    [InlineData(PlaygroundAvailability.NoAccess, true)]
    [InlineData(PlaygroundAvailability.OutOfFunds, true)]
    [InlineData(PlaygroundAvailability.BillingUnavailable, false)]
    [InlineData(PlaygroundAvailability.ModelUnavailable, false)]
    [InlineData(PlaygroundAvailability.RateLimited, false)]
    public void OnlyTheStatesTheUserCanActOnAreMarkedAsNeedingAction(
        PlaygroundAvailability state,
        bool expected) =>
        Assert.Equal(expected, state.NeedsUserAction());
}

/// <summary>
/// The refusal mapping, which is where a status code stops being enough.
/// </summary>
public class RefusalMappingTests
{
    [Theory]
    [InlineData("PLAYGROUND_LOCKED", ApiError.Locked)]
    [InlineData("INSUFFICIENT_BALANCE", ApiError.OutOfFunds)]
    [InlineData("BILLING_UNAVAILABLE", ApiError.BillingUnavailable)]
    [InlineData("MODEL_BUSY", ApiError.ModelBusy)]
    [InlineData("UPSTREAM_ERROR", ApiError.Upstream)]
    [InlineData("ACCOUNT_REQUIRED", ApiError.Unauthenticated)]
    public void TheServersErrorCodeIsMorePreciseThanItsStatus(string code, ApiError expected) =>
        // 503 covers both "we could not check your balance" and "the model is loading", and
        // those call for different things from the user, so the code is read first.
        Assert.Equal(expected, DesktopApiClient.MapRefusal(503, code));

    [Fact]
    public void AnUnknownCodeFallsBackToTheStatus()
    {
        Assert.Equal(ApiError.Locked, DesktopApiClient.MapRefusal(403, null));
        Assert.Equal(ApiError.Locked, DesktopApiClient.MapRefusal(403, "SOMETHING_NEW"));
        Assert.Equal(ApiError.OutOfFunds, DesktopApiClient.MapRefusal(402, null));
    }

    [Fact]
    public void ModelBusyAndBillingUnavailableAreDifferentStates()
    {
        // One is retryable in a moment; the other is our fault. Folding them together would
        // tell a user to top up their wallet when the model is merely loading.
        Assert.NotEqual(
            PlaygroundAvailabilityExtensions.From(ApiError.ModelBusy),
            PlaygroundAvailabilityExtensions.From(ApiError.BillingUnavailable));
    }
}

public class ModelCatalogueTests
{
    private static Entitlement Entitlement(
        bool hasAccess = true,
        bool canGenerate = true,
        params ModelEntry[] models) => new()
    {
        CanGenerate = canGenerate,
        // HasAccess is derived from this, so it is the one place the fact is set.
        Access = new SpectreAccess { HasAccess = hasAccess, Source = hasAccess ? "addon" : null },
        Models = models,
    };

    private static ModelEntry Model(
        string key,
        string label,
        decimal input = 0.30m,
        decimal output = 1.50m,
        bool usesAllowance = true,
        bool canPay = true) => new()
    {
        ModelKey = key,
        Label = label,
        InputPer1M = input,
        OutputPer1M = output,
        UsesAllowance = usesAllowance,
        // Locked is deliberately not set here. The catalogue derives availability from the
        // entitlement and the server's own usesAllowance answer, so a per-model Locked flag
        // in the fixture would be a second source of truth that nothing reads.
    };

    [Fact]
    public void EveryModelIsListedLockedOrNot()
    {
        // Locked models are shown with their prices, not hidden. The screen's job is to show
        // what exists and what it would cost.
        var entitlement = Entitlement(
            hasAccess: false,
            models:
            [
                Model("a", "Model A"),
                Model("b", "Model B"),
            ]);

        var catalogue = new ModelCatalogue(entitlement);

        Assert.Equal(2, catalogue.Models.Count);
        Assert.All(catalogue.Models, m => Assert.Equal(ModelAvailability.Locked, m.Availability));
        Assert.Empty(catalogue.Usable);
    }

    [Fact]
    public void AModelTheAllowanceCoversIsIncluded()
    {
        var catalogue = new ModelCatalogue(Entitlement(models: Model("a", "Model A")));

        var model = Assert.Single(catalogue.Models);
        Assert.Equal(ModelAvailability.Included, model.Availability);
    }

    [Fact]
    public void AModelOutsideTheAllowanceIsWalletOnlyRatherThanPlainlyAvailable()
    {
        // The 8B on a Max plan runs, and comes out of the wallet. Calling it simply
        // "available" would hide that it costs real money on a plan that is supposed to be
        // covered.
        var catalogue = new ModelCatalogue(Entitlement(models:
            Model("a", "Model A", usesAllowance: false)));

        var model = Assert.Single(catalogue.Models);
        Assert.Equal(ModelAvailability.WalletOnly, model.Availability);
        Assert.True(model.IsUsable);
    }

    [Fact]
    public void AMissingLabelFallsBackToTheKey()
    {
        // Ugly, but honest. Inventing a nicer name here would drift from the server's.
        var catalogue = new ModelCatalogue(Entitlement(models:
            Model("lfm2_5_230m_q4_k_m", label: null!)));

        Assert.Equal("lfm2_5_230m_q4_k_m", catalogue.Models[0].Label);
    }

    [Fact]
    public void TheDefaultModelIsTheCheapestOneThatCanBePaidFor()
    {
        // The cheapest *affordable* one, deliberately. Defaulting to the most capable model
        // would silently pick a wallet-only 8B on a Max plan, and the first message would be
        // refused for money the user did not know they were being asked to spend.
        var catalogue = new ModelCatalogue(Entitlement(models:
        [
            Model("small", "Small", input: 0.30m),
            Model("big", "Big", input: 20m),
            Model("middle", "Middle", input: 2m),
        ]));

        Assert.Equal("small", catalogue.DefaultModel!.ModelKey);
    }

    [Fact]
    public void WithNothingUsableThereIsNoDefault()
    {
        // Offering a model that will fail is worse than offering none.
        var catalogue = new ModelCatalogue(Entitlement(
            hasAccess: false,
            models: Model("a", "Model A")));

        Assert.Null(catalogue.DefaultModel);
    }

    [Fact]
    public void TheCostEstimateIsTheSameArithmeticTheServerUses()
    {
        var catalogue = new ModelCatalogue(Entitlement(models:
            Model("a", "Model A", input: 0.30m, output: 1.50m)));

        var model = catalogue.Models[0];
        // 1M input at 0.30, 1M output at 1.50.
        Assert.Equal(1.80m, model.EstimateCost(1_000_000, 1_000_000));
        Assert.Equal(0.30m, model.EstimateCost(1_000_000, 0));
        Assert.Equal(0m, model.EstimateCost(0, 0));
    }
}