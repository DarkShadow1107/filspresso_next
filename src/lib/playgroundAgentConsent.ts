import type { AgentApproval, AgentApprovalDecision } from "./playgroundAgentLoop";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function valid(approval: AgentApproval) {
	return UUID.test(approval.id) && approval.workspace?.location === "hosted-docker" && UUID.test(approval.workspace.id) &&
		(approval.effect === "mutation" || approval.effect === "execution" || (approval.effect === "read_only" && approval.call?.name === "web_search")) && approval.call &&
		/^[A-Za-z0-9_-]{1,64}$/.test(approval.call.id) && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(approval.call.name) &&
		typeof approval.call.arguments === "string" && new TextEncoder().encode(approval.call.arguments).length <= 16_384;
}

/** A local fresh-consent rendezvous, NOT executor authority or durable approval evidence.
 * An executor/server must independently bind and consume consent for the exact action. */
export class AgentConsentQueue {
	private pending: { approval: AgentApproval; resolve: (decision: AgentApprovalDecision) => void; signal: AbortSignal; cancel: () => void } | null = null;
	private readonly issued = new Set<string>();
	private readonly listeners = new Set<() => void>();
	getSnapshot = (): AgentApproval | null => this.pending?.approval ?? null;
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	private publish() { for (const listener of this.listeners) listener(); }
	request = async (approval: AgentApproval, signal: AbortSignal): Promise<AgentApprovalDecision> => {
		if (signal.aborted || this.pending || !valid(approval) || this.issued.has(approval.id) || this.issued.size >= 4096) return Object.freeze({ approvalId: approval.id, approved: false });
		this.issued.add(approval.id);
		const snapshot = Object.freeze({ ...approval, workspace: Object.freeze({ ...approval.workspace }), call: Object.freeze({ ...approval.call }) });
		return new Promise(resolve => {
			const cancel = () => { this.decide(snapshot.id, false); };
			this.pending = { approval: snapshot, resolve, signal, cancel };
			signal.addEventListener("abort", cancel, { once: true });
			this.publish();
		});
	};
	decide = (approvalId: string, approved: boolean): boolean => {
		const current = this.pending;
		if (!current || current.approval.id !== approvalId) return false;
		this.pending = null; current.signal.removeEventListener("abort", current.cancel);
		current.resolve(Object.freeze({ approvalId, approved: approved === true && !current.signal.aborted }));
		this.publish(); return true;
	};
	clear = () => { if (this.pending) this.decide(this.pending.approval.id, false); };
}
