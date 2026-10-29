import type { NativeConversationTurn } from "./playgroundAgent";

/** The visible thread crosses a mode boundary as ordinary message data, never executable
 * tool calls, system instructions or restored approval. Refuse overflow, never silently trim. */
export function conversationContext(messages: readonly { role: "user" | "assistant"; content: string; failed?: boolean }[]): NativeConversationTurn[] {
	const turns: NativeConversationTurn[] = [];
	for (let index = 0; index < messages.length; index += 2) {
		const user = messages[index], assistant = messages[index + 1];
		if (user?.role !== "user" || assistant?.role !== "assistant") throw new Error("This transcript has an incomplete message pair. Start a new conversation to use agent tools.");
		if (user.content.length > 8000 || assistant.content.length > 32768 || !user.content.trim()) throw new Error("A message exceeds the agent context limit. Export this thread and start a new conversation; nothing was silently removed.");
		turns.push({ message: user.content, text: assistant.content, history: [] });
	}
	if (turns.length >= 16 || JSON.stringify(turns).length > 196608) throw new Error("Agent context limit reached. Export this thread and start a new conversation; nothing was silently removed.");
	return turns;
}
