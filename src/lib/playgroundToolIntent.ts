/** Explicit requests for a web lookup use the agent path; ordinary chat remains streamed. */
export function explicitlyRequestsWebSearch(input: string): boolean {
	return /\b(?:search|look\s*up|browse)\b[\s\S]{0,80}\b(?:web|online|internet)\b|\b(?:search|browse)\s+(?:the\s+)?(?:web|internet)\b/i.test(input);
}
