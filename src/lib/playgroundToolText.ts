/** Display-only handling for model-emitted LFM markers. Never dispatch text as a tool. */
export function displayToolText(text: string, streaming = false): { text: string; names: string[] } {
	const start = "<|tool_call_start|>";
	const end = "<|tool_call_end|>";
	const names: string[] = [];
	const nameFor = (body: string) => {
		const name = /^\s*\[?\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\(/.exec(body)?.[1];
		return name || "Unknown tool";
	};
	let visible = "";
	let rest = text;
	for (;;) {
		const begin = rest.indexOf(start);
		if (begin < 0) { visible += rest; break; }
		visible += rest.slice(0, begin);
		const finish = rest.indexOf(end, begin + start.length);
		if (finish < 0) { if (!streaming) names.push(nameFor(rest.slice(begin + start.length))); break; }
		names.push(nameFor(rest.slice(begin + start.length, finish)));
		rest = rest.slice(finish + end.length);
	}
	if (streaming) {
		for (let length = Math.min(start.length - 1, visible.length); length > 0; length--) {
			if (visible.endsWith(start.slice(0, length))) { visible = visible.slice(0, -length); break; }
		}
	}
	return { text: visible, names };
}
