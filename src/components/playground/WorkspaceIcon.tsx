import type { SVGProps } from "react";

type IconName = "sidebar" | "new" | "search" | "settings" | "prices" | "plus" | "send" | "stop" | "close" | "copy" | "check" | "retry" | "trash" | "edit" | "model" | "display" | "transfer" | "download" | "brain";

const paths: Record<IconName, string> = {
	sidebar: "M4 4h16v16H4z M9 4v16",
	new: "M12 5H5v14h14v-7 M16 3l5 5 M10 14l2-5 6-6 5 5-6 6z",
	search: "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M16 16l6 6",
	settings: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
	prices: "M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3z M4 6v6c0 2 4 3 8 3s8-1 8-3V6 M4 12v6c0 2 4 3 8 3s8-1 8-3v-6",
	plus: "M12 5v14 M5 12h14",
	send: "M12 19V5 M6 11l6-6 6 6",
	stop: "M6 6h12v12H6z",
	close: "M6 6l12 12 M18 6 6 18",
	copy: "M8 8h12v13H8z M16 8V3H3v13h5",
	check: "M4 12l5 5L20 6",
	retry: "M20 7V3l-4 4 M20 7a9 9 0 1 0 1 9 M20 7h-5",
	trash: "M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
	edit: "m4 16 12-12 4 4-12 12H4z M13 7l4 4",
	model: "m12 3 9 5v8l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v8 M8 5l9 5",
	display: "M3 3h18v14H3z M12 17v4 M8 21h8",
	transfer: "M7 3v15 M3 7l4-4 4 4 M17 21V6 M13 17l4 4 4-4",
	download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
	brain: "M12 4v16 M12 5c-4-5-9 0-6 3-5 2-3 7 0 7-2 5 4 8 6 4 M12 5c4-5 9 0 6 3 5 2 3 7 0 7 2 5-4 8-6 4",
};

export default function WorkspaceIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
			<path d={paths[name]} />
		</svg>
	);
}
