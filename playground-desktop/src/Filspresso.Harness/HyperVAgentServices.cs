using Filspresso.Sandbox;

namespace Filspresso.Harness;

/// <summary>Legacy operator-managed backend. Never selected as a Windows Sandbox fallback.</summary>
public sealed class HyperVAgentServices : SandboxAgentServices
{
    public HyperVAgentServices(INativeAgentModelTransport transport, HyperVSandbox sandbox,
        HyperVQualificationReceipt receipt, ProjectCheckpoints checkpoints, bool executionQualified,
        string executionStatus, AgentConsentQueue? consent = null)
        : base(transport, sandbox, CodeLocation.HyperV, checkpoints, executionQualified, executionStatus, consent)
    { System.ArgumentNullException.ThrowIfNull(receipt); }
}
