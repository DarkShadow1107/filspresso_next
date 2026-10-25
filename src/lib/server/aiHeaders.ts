/** Internal credentials never come from browser-supplied headers. */
export function aiServiceHeaders(): Record<string, string> {
	const key = process.env.AI_SERVICE_KEY?.trim();
	return key ? { "x-ai-service-key": key } : {};
}
