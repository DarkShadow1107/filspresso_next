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

	// Generate primary color palette
	const hue = hashCode(seed, 0) % 360;
	const saturation = (hashCode(seed, 1) % 35) + 65; // 65-100%
	const lightness = (hashCode(seed, 2) % 15) + 50; // 50-65%

	const primaryColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
	const darkColor = `hsl(${hue}, ${saturation}%, ${lightness - 15}%)`;
	const lightColorBg = `hsl(${hue}, ${saturation - 20}%, ${lightness + 10}%)`;

	// Complementary and triadic colors
	const accentHue1 = (hue + 120) % 360;
	const accentHue2 = (hue + 240) % 360;
	const accentColor1 = `hsl(${accentHue1}, ${saturation - 10}%, ${lightness + 5}%)`;
	const accentColor2 = `hsl(${accentHue2}, ${saturation - 15}%, ${lightness}%)`;

	const gradId1 = `grad1-${Math.random().toString(36).substr(2, 9)}`;
	const gradId2 = `grad2-${Math.random().toString(36).substr(2, 9)}`;
	const gradId3 = `grad3-${Math.random().toString(36).substr(2, 9)}`;
	const filterShadow = `filter-${Math.random().toString(36).substr(2, 9)}`;

	// Create defs with multiple gradients and filters
	const defs = `<defs>
		<linearGradient id='${gradId1}' x1='0%' y1='0%' x2='100%' y2='100%'>
			<stop offset='0%' style='stop-color:${primaryColor};stop-opacity:1' />
			<stop offset='50%' style='stop-color:${lightColorBg};stop-opacity:0.9' />
			<stop offset='100%' style='stop-color:${darkColor};stop-opacity:1' />
		</linearGradient>
		<radialGradient id='${gradId2}' cx='35%' cy='35%' r='65%'>
			<stop offset='0%' style='stop-color:${lightColorBg};stop-opacity:0.4' />
			<stop offset='100%' style='stop-color:${darkColor};stop-opacity:0.8' />
		</radialGradient>
		<linearGradient id='${gradId3}' x1='100%' y1='0%' x2='0%' y2='100%'>
			<stop offset='0%' style='stop-color:${accentColor1};stop-opacity:0.6' />
			<stop offset='100%' style='stop-color:${accentColor2};stop-opacity:0.4' />
		</linearGradient>
		<filter id='${filterShadow}' x='-50%' y='-50%' width='200%' height='200%'>
			<feGaussianBlur in='SourceGraphic' stdDeviation='1.5'/>
			<feDropShadow dx='0' dy='1' stdDeviation='1.5' flood-color='rgba(0,0,0,0.3)' flood-opacity='0.8'/>
		</filter>
	</defs>`;

	// Base background layers
	let background = `<rect width='50' height='50' rx='9' fill='url(#${gradId1})' />
		<rect width='50' height='50' rx='9' fill='url(#${gradId2})' />`;

	// Generate complex pattern shapes
	const shapeCount = (hashCode(seed, 3) % 5) + 5; // 5-9 shapes
	let shapes = "";
	let decorElements = "";

	for (let i = 0; i < shapeCount; i++) {
		const shapeType = hashCode(seed, 4 + i) % 5;
		const x = (hashCode(seed, 5 + i) % 45) + 2.5;
		const y = (hashCode(seed, 6 + i) % 45) + 2.5;
		const size = (hashCode(seed, 7 + i) % 12) + 4;
		const opacity = ((hashCode(seed, 8 + i) % 60) + 20) / 100;
		const rotation = hashCode(seed, 9 + i) % 360;
		const useAccent1 = hashCode(seed, 10 + i) % 2 === 0;
		const fillColor = useAccent1 ? accentColor1 : accentColor2;

		if (shapeType === 0) {
			// Circle with glow effect
			shapes += `<circle cx='${x}' cy='${y}' r='${size}' fill='${fillColor}' opacity='${opacity}' filter='url(#${filterShadow})' />`;
			decorElements += `<circle cx='${x}' cy='${y}' r='${
				size + 1
			}' fill='none' stroke='${fillColor}' stroke-width='0.5' opacity='${opacity * 0.5}' />`;
		} else if (shapeType === 1) {
			// Rounded rectangle
			const width = size * 2.5;
			const height = size * 1.8;
			shapes += `<rect x='${x - width / 2}' y='${y - height / 2}' width='${width}' height='${height}' rx='${
				size * 0.4
			}' fill='url(#${gradId3})' opacity='${opacity}' transform='rotate(${rotation} ${x} ${y})' filter='url(#${filterShadow})' />`;
		} else if (shapeType === 2) {
			// Star/polygon
			const points: [number, number][] = [];
			for (let j = 0; j < 6; j++) {
				const angle = (j / 6) * Math.PI * 2 + (rotation * Math.PI) / 180;
				const r = j % 2 === 0 ? size : size * 0.5;
				points.push([x + Math.cos(angle) * r, y + Math.sin(angle) * r]);
			}
			shapes += `<polygon points='${points
				.map((p) => p.join(","))
				.join(" ")}' fill='${fillColor}' opacity='${opacity}' filter='url(#${filterShadow})' />`;
		} else if (shapeType === 3) {
			// Path-based organic shape
			const offset = size * 0.6;
			const paths = `M ${x} ${y - size} Q ${x + offset} ${y - offset} ${x + size} ${y} Q ${x + offset} ${y + offset} ${x} ${
				y + size
			} Q ${x - offset} ${y + offset} ${x - size} ${y} Q ${x - offset} ${y - offset} ${x} ${y - size}`;
			shapes += `<path d='${paths}' fill='${fillColor}' opacity='${opacity}' filter='url(#${filterShadow})' />`;
		} else {
			// Diamond/rotated square
			shapes += `<rect x='${x - size}' y='${y - size}' width='${size * 2}' height='${
				size * 2
			}' fill='${fillColor}' opacity='${opacity}' transform='rotate(45 ${x} ${y})' filter='url(#${filterShadow})' />`;
		}
	}

	// Add decorative circles and arcs for extra complexity
	for (let i = 0; i < 3; i++) {
		const cx = (hashCode(seed, 100 + i) % 35) + 7.5;
		const cy = (hashCode(seed, 101 + i) % 35) + 7.5;
		const r = (hashCode(seed, 102 + i) % 8) + 3;
		const arcOpacity = ((hashCode(seed, 103 + i) % 30) + 10) / 100;
		decorElements += `<circle cx='${cx}' cy='${cy}' r='${r}' fill='none' stroke='${accentColor1}' stroke-width='0.8' opacity='${arcOpacity}' />`;
	}

	// Overlay accent gradient
	const overlay = `<rect width='50' height='50' rx='9' fill='url(#${gradId3})' opacity='0.15' />`;

	const initials = seed
		.split(" ")
		.map((p) => p[0])
		.slice(0, 2)
		.join("")
		.toUpperCase();

	const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='50' height='50' viewBox='0 0 50 50'>
${defs}
${background}
${shapes}
${decorElements}
${overlay}
<text x='50%' y='52%' font-family='Inter, Arial, sans-serif' font-size='17' fill='white' text-anchor='middle' dominant-baseline='middle' font-weight='800' letter-spacing='0.5'>${initials}</text>
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
		[onChange]
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
