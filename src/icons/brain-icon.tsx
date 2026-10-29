import type { SVGProps } from "react";

/** Shared thinking glyph, also rasterized for the Windows app. */
export default function BrainIcon({ size = 20, color = "currentColor", ...props }: SVGProps<SVGSVGElement> & { size?: number; color?: string }) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 3 10a4 4 0 0 0 .7 7.3A4 4 0 0 0 12 18Zm0 0V5a3 3 0 0 1 5.8-1A4 4 0 0 1 21 10a4 4 0 0 1-.7 7.3A4 4 0 0 1 12 18ZM7 4v3m10-3v3M3 10h4m14 0h-4M7 14v3m10-3v3" /></svg>;
}
