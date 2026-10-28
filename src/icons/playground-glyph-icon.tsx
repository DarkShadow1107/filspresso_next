import type { SVGProps } from "react";

export type PlaygroundGlyph = "plus" | "stop" | "display" | "transfer" | "download" | "paperclip" | "help";
const paths: Record<PlaygroundGlyph, string> = {
	plus: "M12 5v14M5 12h14",
	stop: "M6 6h12v12H6z",
	display: "M3 3h18v14H3zM12 17v4M8 21h8",
	transfer: "M7 3v15M3 7l4-4 4 4M17 21V6M13 17l4 4 4-4",
	download: "M12 3v12M7 10l5 5 5-5M4 16v5h16v-5",
	paperclip: "m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9a2 2 0 0 1 7 7l-9 9a1 1 0 0 1-3-3l8-8",
	help: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1 .7-1.7 1.2-1.7 2.7M12 17h.01",
};

export default function PlaygroundGlyphIcon({ glyph = "plus", size = 20, color = "currentColor", ...props }: SVGProps<SVGSVGElement> & { glyph?: PlaygroundGlyph; size?: number; color?: string }) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[glyph]} /></svg>;
}
