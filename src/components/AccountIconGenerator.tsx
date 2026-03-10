"use client";

import { useCallback, useState } from "react";

type Props = {
	username?: string;
	onChange?: (svgDataUrl: string) => void;
};

// Generate deterministic but complex random avatar
function generateComplexAvatar(seed: string): string {
	// Hash function for consistent randomization
	function hashCode(s: string, index: number = 0): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) {
			h = (h << 5) - h + s.charCodeAt(i) + index;
			h = h & h;
		}
		return Math.abs(h);
	}

	// Derive stable IDs from seed (no Math.random for id generation to keep determinism)
	const uid = hashCode(seed, 999).toString(36);

	// Color palette inspired by the username
	const hue = hashCode(seed, 0) % 360;
	const hue2 = (hue + 40 + (hashCode(seed, 50) % 80)) % 360; // analogous hue
	const hue3 = (hue + 180 + (hashCode(seed, 51) % 40) - 20) % 360; // near-complementary
	const sat = (hashCode(seed, 1) % 30) + 70; // 70-100%
	const lit = (hashCode(seed, 2) % 10) + 48; // 48-58%
	const litDark = lit - 18;
	const litBright = lit + 16;

	const c1 = `hsl(${hue}, ${sat}%, ${lit}%)`;
	const c2 = `hsl(${hue2}, ${sat - 10}%, ${lit + 8}%)`;
	const c3 = `hsl(${hue3}, ${sat - 5}%, ${litDark}%)`;
	const cAccent = `hsl(${hue3}, ${sat}%, ${litBright}%)`;
	const cFaint = `hsl(${hue2}, ${sat - 30}%, ${litBright + 10}%)`;

	// Pick background style: 0=diagonal gradient, 1=radial burst, 2=diagonal split
	const bgStyle = hashCode(seed, 20) % 3;

	const g1 = `g1${uid}`,
		g2 = `g2${uid}`,
		g3 = `g3${uid}`,
		g4 = `g4${uid}`;
	const fShadow = `fs${uid}`,
		fGlow = `fg${uid}`,
		clip1 = `cl${uid}`;

	// Defs section: gradients + filters + clipPath
	const defs = `<defs>
  <linearGradient id='${g1}' x1='0%' y1='0%' x2='100%' y2='100%'>
    <stop offset='0%' stop-color='${c1}'/>
    <stop offset='55%' stop-color='${c2}'/>
    <stop offset='100%' stop-color='${c3}'/>
  </linearGradient>
  <radialGradient id='${g2}' cx='30%' cy='28%' r='70%'>
    <stop offset='0%' stop-color='${cFaint}' stop-opacity='0.55'/>
    <stop offset='100%' stop-color='${c3}' stop-opacity='0.85'/>
  </radialGradient>
  <linearGradient id='${g3}' x1='100%' y1='0%' x2='0%' y2='100%'>
    <stop offset='0%' stop-color='${cAccent}' stop-opacity='0.7'/>
    <stop offset='100%' stop-color='${c2}' stop-opacity='0.3'/>
  </linearGradient>
  <radialGradient id='${g4}' cx='70%' cy='70%' r='50%'>
    <stop offset='0%' stop-color='${cFaint}' stop-opacity='0.4'/>
    <stop offset='100%' stop-color='${c1}' stop-opacity='0'/>
  </radialGradient>
  <filter id='${fShadow}' x='-30%' y='-30%' width='160%' height='160%'>
    <feDropShadow dx='0' dy='1' stdDeviation='1.2' flood-color='rgba(0,0,0,0.45)'/>
  </filter>
  <filter id='${fGlow}' x='-40%' y='-40%' width='180%' height='180%'>
    <feGaussianBlur in='SourceGraphic' stdDeviation='2' result='blur'/>
    <feComposite in='SourceGraphic' in2='blur' operator='over'/>
  </filter>
  <clipPath id='${clip1}'>
    <rect width='50' height='50' rx='11'/>
  </clipPath>
</defs>`;

	// Background layers
	let bg = `<rect width='50' height='50' rx='11' fill='url(#${g1})'/>`;
	if (bgStyle === 1) {
		bg = `<rect width='50' height='50' rx='11' fill='url(#${g2})'/>
<rect width='50' height='50' rx='11' fill='url(#${g1})' opacity='0.7'/>`;
	} else if (bgStyle === 2) {
		const splitX = 12 + (hashCode(seed, 21) % 26);
		bg = `<rect width='50' height='50' rx='11' fill='${c3}'/>
<polygon points='0,0 ${splitX},0 0,50' fill='${c1}' clip-path='url(#${clip1})'/>
<polygon points='50,50 ${50 - splitX},50 50,0' fill='${c2}' clip-path='url(#${clip1})' opacity='0.75'/>`;
	}

	// Highlight layer (top-left shine)
	const highlight = `<ellipse cx='14' cy='11' rx='13' ry='9' fill='white' opacity='0.09'/>`;

	// Noise/texture layer - small dots pattern
	let texture = "";
	const dotRows = 5;
	const dotCols = 5;
	for (let r = 0; r < dotRows; r++) {
		for (let c = 0; c < dotCols; c++) {
			const tx = 4 + c * 10 + (hashCode(seed, 200 + r * dotCols + c) % 5) - 2;
			const ty = 4 + r * 10 + (hashCode(seed, 300 + r * dotCols + c) % 5) - 2;
			const opacity = ((hashCode(seed, 400 + r * dotCols + c) % 18) + 4) / 100;
			texture += `<circle cx='${tx}' cy='${ty}' r='0.8' fill='white' opacity='${opacity}'/>`;
		}
	}

	// Geometric midground shapes
	const shapeCount = (hashCode(seed, 3) % 4) + 4; // 4-7 shapes
	let shapes = "";
	for (let i = 0; i < shapeCount; i++) {
		const shapeType = hashCode(seed, 4 + i * 3) % 7;
		const cx = (hashCode(seed, 5 + i * 3) % 42) + 4;
		const cy = (hashCode(seed, 6 + i * 3) % 42) + 4;
		const sz = (hashCode(seed, 7 + i * 3) % 10) + 4;
		const op = ((hashCode(seed, 8 + i * 3) % 45) + 18) / 100;
		const rot = hashCode(seed, 9 + i * 3) % 360;
		const fill = hashCode(seed, 10 + i * 3) % 2 === 0 ? cAccent : cFaint;

		if (shapeType === 0) {
			// Glow circle
			shapes += `<circle cx='${cx}' cy='${cy}' r='${sz}' fill='${fill}' opacity='${op}' filter='url(#${fGlow})'/>`;
			shapes += `<circle cx='${cx}' cy='${cy}' r='${sz * 0.5}' fill='white' opacity='${op * 0.25}'/>`;
		} else if (shapeType === 1) {
			// Rounded rect with rotation
			const w = sz * 2.2,
				h = sz * 1.4;
			shapes += `<rect x='${cx - w / 2}' y='${cy - h / 2}' width='${w}' height='${h}' rx='${sz * 0.45}' fill='url(#${g3})' opacity='${op}' transform='rotate(${rot} ${cx} ${cy})' filter='url(#${fShadow})'/>`;
		} else if (shapeType === 2) {
			// Hexagon
			const pts = Array.from({ length: 6 }, (_, j) => {
				const a = (j / 6) * Math.PI * 2 - Math.PI / 6 + (rot * Math.PI) / 180;
				return `${(cx + Math.cos(a) * sz).toFixed(2)},${(cy + Math.sin(a) * sz).toFixed(2)}`;
			}).join(" ");
			shapes += `<polygon points='${pts}' fill='${fill}' opacity='${op}' filter='url(#${fShadow})'/>`;
		} else if (shapeType === 3) {
			// Organic blob (cubic bezier)
			const r1 = sz,
				r2 = sz * 0.7,
				r3 = sz * 1.2,
				r4 = sz * 0.85;
			const d = `M ${cx} ${cy - r1} C ${cx + r3} ${cy - r2} ${cx + r2} ${cy + r3} ${cx} ${cy + r4} C ${cx - r2} ${cy + r3} ${cx - r3} ${cy - r2} ${cx} ${cy - r1} Z`;
			shapes += `<path d='${d}' fill='${fill}' opacity='${op}' transform='rotate(${rot} ${cx} ${cy})' filter='url(#${fGlow})'/>`;
		} else if (shapeType === 4) {
			// Ring / donut
			shapes += `<circle cx='${cx}' cy='${cy}' r='${sz}' fill='none' stroke='${fill}' stroke-width='${1.5 + (hashCode(seed, 11 + i) % 20) / 10}' opacity='${op}'/>`;
		} else if (shapeType === 5) {
			// Star (5-pointed)
			const starPts = Array.from({ length: 10 }, (_, j) => {
				const a = (j / 10) * Math.PI * 2 - Math.PI / 2 + (rot * Math.PI) / 180;
				const r = j % 2 === 0 ? sz : sz * 0.42;
				return `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
			}).join(" ");
			shapes += `<polygon points='${starPts}' fill='${fill}' opacity='${op}' filter='url(#${fShadow})'/>`;
		} else {
			// Arrow / chevron
			const hw = sz * 0.8;
			const d = `M ${cx - hw} ${cy - sz * 0.4} L ${cx} ${cy - sz} L ${cx + hw} ${cy - sz * 0.4} L ${cx + hw * 0.5} ${cy - sz * 0.4} L ${cx + hw * 0.5} ${cy + sz} L ${cx - hw * 0.5} ${cy + sz} L ${cx - hw * 0.5} ${cy - sz * 0.4} Z`;
			shapes += `<path d='${d}' fill='${fill}' opacity='${op * 0.7}' transform='rotate(${rot} ${cx} ${cy})'/>`;
		}
	}

	// Decorative line strokes (Art Deco / geometric)
	let strokes = "";
	const lineCount = (hashCode(seed, 60) % 3) + 2;
	for (let i = 0; i < lineCount; i++) {
		const lx1 = hashCode(seed, 60 + i * 2) % 50;
		const ly1 = hashCode(seed, 61 + i * 2) % 50;
		const lx2 = (lx1 + 10 + (hashCode(seed, 62 + i * 2) % 25)) % 50;
		const ly2 = (ly1 + 10 + (hashCode(seed, 63 + i * 2) % 25)) % 50;
		const lop = ((hashCode(seed, 64 + i * 2) % 25) + 10) / 100;
		strokes += `<line x1='${lx1}' y1='${ly1}' x2='${lx2}' y2='${ly2}' stroke='white' stroke-width='0.6' opacity='${lop}' stroke-linecap='round'/>`;
	}

	// Corner accent arcs
	const arcR = 6 + (hashCode(seed, 80) % 8);
	const arcOp = ((hashCode(seed, 81) % 25) + 10) / 100;
	const arcs = `<path d='M 2,${arcR + 2} A ${arcR} ${arcR} 0 0 1 ${arcR + 2},2' stroke='${cAccent}' stroke-width='1.5' fill='none' opacity='${arcOp}' stroke-linecap='round'/>
<path d='M 48,${50 - arcR - 2} A ${arcR} ${arcR} 0 0 1 ${50 - arcR - 2},48' stroke='${cFaint}' stroke-width='1.5' fill='none' opacity='${arcOp}' stroke-linecap='round'/>`;

	// Overlay tint
	const overlay = `<rect width='50' height='50' rx='11' fill='url(#${g4})' opacity='0.35'/>`;

	// Username initials — up to 2 characters
	const initials =
		seed
			.replace(/[^a-zA-Z\s]/g, "")
			.trim()
			.split(/\s+/)
			.map((p) => p[0] || "")
			.slice(0, 2)
			.join("")
			.toUpperCase() || seed.slice(0, 1).toUpperCase();

	// Choose text style variant
	const textVariant = hashCode(seed, 90) % 3;
	let textEl = "";
	if (textVariant === 0) {
		// Bold centered
		textEl = `<text x='50%' y='53%' font-family='Inter, system-ui, sans-serif' font-size='18' fill='white' text-anchor='middle' dominant-baseline='middle' font-weight='900' letter-spacing='1' filter='url(#${fShadow})'>${initials}</text>`;
	} else if (textVariant === 1) {
		// Outlined + filled
		textEl = `<text x='50%' y='53%' font-family='Inter, system-ui, sans-serif' font-size='17' fill='none' stroke='rgba(255,255,255,0.9)' stroke-width='1' text-anchor='middle' dominant-baseline='middle' font-weight='800' letter-spacing='1.5'>${initials}</text>
<text x='50%' y='53%' font-family='Inter, system-ui, sans-serif' font-size='17' fill='white' text-anchor='middle' dominant-baseline='middle' font-weight='800' letter-spacing='1.5' opacity='0.75'>${initials}</text>`;
	} else {
		// Large single letter with shadow
		const single = initials.slice(0, 1);
		textEl = `<text x='50%' y='53%' font-family='Georgia, serif' font-size='26' fill='white' text-anchor='middle' dominant-baseline='middle' font-weight='700' filter='url(#${fShadow})' opacity='0.95'>${single}</text>`;
	}

	const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%' viewBox='0 0 50 50'>
${defs}
${bg}
${texture}
${shapes}
${strokes}
${arcs}
${highlight}
${overlay}
${textEl}
</svg>`;

	return svgText;
}

export default function AccountIconGenerator({ username = "user", onChange }: Props) {
	const [svgStr, setSvgStr] = useState("");
	const [seed, setSeed] = useState(username + Math.random());

	const generateNewIcon = useCallback(() => {
		const newSeed = username + Math.random();
		setSeed(newSeed);
		const newSvg = generateComplexAvatar(newSeed);
		setSvgStr(newSvg);
		const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(newSvg)}`;
		onChange?.(svgDataUrl);
	}, [username, onChange]);

	const currentSvg = svgStr || generateComplexAvatar(seed);

	const handleUpload = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const f = e.target.files?.[0];
			if (!f) return;
			const reader = new FileReader();
			reader.onload = () => {
				const text = String(reader.result ?? "");
				setSvgStr(text);
				onChange?.(`data:image/svg+xml;utf8,${encodeURIComponent(text)}`);
			};
			reader.readAsText(f);
		},
		[onChange],
	);

	const handleDownload = useCallback(() => {
		const blob = new Blob([svgStr || currentSvg], { type: "image/svg+xml" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${username || "avatar"}.svg`;
		a.click();
		URL.revokeObjectURL(url);
	}, [svgStr, username, currentSvg]);

	return (
		<div className="account-icon-generator">
			<p>Profile Icon</p>
			<div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
				<div
					dangerouslySetInnerHTML={{ __html: currentSvg }}
					style={{
						width: 64,
						height: 64,
						borderRadius: 12,
						overflow: "hidden",
						boxShadow: "0 4px 16px rgba(0,0,0,0.4), 0 0 0 2px rgba(255, 185, 115, 0.35)",
						border: "2px solid rgba(255, 185, 115, 0.2)",
						background: "rgba(20, 20, 25, 0.6)",
					}}
				/>
				<div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
					<button type="button" className="btn" onClick={generateNewIcon}>
						Generate
					</button>
					<label className="btn" style={{ margin: 0 }}>
						Upload
						<input type="file" accept="image/svg+xml" onChange={handleUpload} style={{ display: "none" }} />
					</label>
					<button type="button" className="btn" onClick={handleDownload} disabled={!svgStr && !currentSvg}>
						Download
					</button>
				</div>
			</div>
		</div>
	);
}
