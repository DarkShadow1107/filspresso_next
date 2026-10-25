using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Harness;

/// <summary>
/// Local one-shot consent rendezvous for a future approved executor composition. Not an
/// executor, persisted permission, or server-verified approval/execution evidence. Replaying
/// an old ID, double-clicking, cancelling or dismissing cannot approve a later action.
/// </summary>
public sealed class AgentConsentQueue : IDisposable
{
    private readonly object _gate = new();
    private readonly HashSet<Guid> _issued = new();
    private AgentApproval? _pending;
    private TaskCompletionSource<AgentApprovalDecision>? _decision;
    private CancellationToken _cancellation;
    private bool _disposed;
    public event EventHandler? Changed;
    public AgentApproval? Pending { get { lock (_gate) return _pending; } }

    public async Task<AgentApprovalDecision> RequestAsync(AgentApproval approval, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(approval);
        TaskCompletionSource<AgentApprovalDecision> decision;
        lock (_gate)
        {
            if (_disposed || cancellationToken.IsCancellationRequested || _pending is not null || !Valid(approval) || _issued.Count >= 4096 || !_issued.Add(approval.Id))
                return new(approval.Id, false);
            _pending = approval; _cancellation = cancellationToken;
            _decision = decision = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        using var cancelled = cancellationToken.Register(() => Decide(approval.Id, false));
        Changed?.Invoke(this, EventArgs.Empty);
        return await decision.Task.ConfigureAwait(false);
    }

    public bool Decide(Guid approvalId, bool approved)
    {
        TaskCompletionSource<AgentApprovalDecision> decision;
        lock (_gate)
        {
            if (_pending is null || _pending.Id != approvalId || _decision is null) return false;
            approved = approved && !_cancellation.IsCancellationRequested && !_disposed;
            decision = _decision; _decision = null; _pending = null;
        }
        decision.TrySetResult(new(approvalId, approved)); Changed?.Invoke(this, EventArgs.Empty); return true;
    }

    public void Clear()
    {
        Guid? id; lock (_gate) id = _pending?.Id;
        if (id is { } value) Decide(value, false);
    }
    public void Dispose() { lock (_gate) _disposed = true; Clear(); }

    private static bool Valid(AgentApproval approval) => approval.Id != Guid.Empty && approval.Workspace is { } workspace && workspace.Id != Guid.Empty && Enum.IsDefined(workspace.Location) &&
        approval.Effect is ToolEffect.Mutation or ToolEffect.Execution && approval.Call is { } call && call.Id is { Length: > 0 and <= 64 } &&
        call.Id.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-') && ToolArgumentSchema.IsIdentifier(call.Name) &&
        call.ArgumentsJson is { Length: <= ToolArgumentSchema.MaxArgumentBytes };
}
