export * from "../../nestjs-backend/src/desktop/playground-question-contract";
import { parseQuestionForm, validateQuestionDecision, QUESTION_SCHEMA, type QuestionChallenge, type QuestionDecision } from "../../nestjs-backend/src/desktop/playground-question-contract";
import type { NativeTool } from "./playgroundAgent";
export const questionTool = (): NativeTool => ({ name: "question", effect: "interaction", description:
	"Ask the user structured clarification questions and wait for their answers. Custom answers are always available. Answers NEVER authorize a file change or command.", parameters: JSON.parse(JSON.stringify(QUESTION_SCHEMA)) });
function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }

/** Local one-shot questions, deliberately independent from execution consent. */
export class AgentQuestionQueue {
	private pending: QuestionChallenge | null = null;
	private settle: ((decision: QuestionDecision) => void) | null = null;
	private readonly issued = new Set<string>();
	private readonly listeners = new Set<() => void>();
	getSnapshot = () => this.pending;
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	private changed() { for (const listener of this.listeners) listener(); }
	async request(value: QuestionChallenge, signal: AbortSignal): Promise<QuestionDecision> {
		signal.throwIfAborted();
		if (this.pending || this.issued.size >= 4096 || value.version !== 1 || !/^[0-9a-f-]{36}$/.test(value.id) || this.issued.has(value.id) || !/^[A-Za-z0-9_-]{1,64}$/.test(value.callId)) throw new Error("A question is already pending or its limit was reached.");
		const challenge: QuestionChallenge = freeze({ version: 1, id: value.id, callId: value.callId, form: parseQuestionForm(JSON.stringify(value.form)) });
		this.issued.add(challenge.id);
		const result = new Promise<QuestionDecision>(resolve => { this.settle = resolve; });
		this.pending = challenge;
		const cancelled = () => this.dismiss(); signal.addEventListener("abort", cancelled, { once: true });
		try { this.changed(); if (signal.aborted) this.dismiss(); return await result; }
		finally { signal.removeEventListener("abort", cancelled); }
	}
	answer = (value: unknown): boolean => {
		if (!this.pending || !this.settle) return false;
		let decision: QuestionDecision; try { decision = validateQuestionDecision(this.pending, value); } catch { return false; }
		const settle = this.settle; this.pending = null; this.settle = null; settle(freeze(decision)); this.changed(); return true;
	};
	dismiss = () => { if (this.pending) this.answer({ version: 1, id: this.pending.id, cancelled: true, answers: [] }); };
}
