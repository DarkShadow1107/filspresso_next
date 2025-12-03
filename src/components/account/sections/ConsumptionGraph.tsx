"use client";

import { useState } from "react";
import { ConsumptionHistory } from "./types";

export type GraphTheme = "classic" | "neon" | "minimal" | "gradient" | "monochrome";

interface ThemeColors {
	original: string;
	vertuo: string;
	background: string;
	grid: string;
	axis: string;
	text: string;
	glowOriginal: boolean;
	glowVertuo: boolean;
	tooltipBg: string;
	tooltipBorder: string;
	cardBg: string;
	cardBorder: string;
	shadowColor: string;
}

const THEMES: Record<GraphTheme, ThemeColors> = {
	classic: {
		original: "#c4a77d",
		vertuo: "#8b5cf6",
		background: "linear-gradient(180deg, rgba(20,18,15,0.95) 0%, rgba(12,10,8,0.98) 100%)",
		grid: "#2d2a26",
		axis: "#4a4540",
		text: "#9a9590",
		glowOriginal: true,
		glowVertuo: true,
		tooltipBg: "rgba(15,12,10,0.97)",
		tooltipBorder: "#c4a77d",
		cardBg: "rgba(20,18,15,0.6)",
		cardBorder: "#3a3530",
		shadowColor: "rgba(196,167,125,0.15)",
	},
	neon: {
		original: "#00ff88",
		vertuo: "#ff00ff",
		background: "linear-gradient(180deg, rgba(5,5,20,0.98) 0%, rgba(10,10,35,0.98) 100%)",
		grid: "#151530",
		axis: "#00aaaa",
		text: "#00cccc",
		glowOriginal: true,
		glowVertuo: true,
		tooltipBg: "rgba(5,5,20,0.98)",
		tooltipBorder: "#00ffff",
		cardBg: "rgba(5,5,25,0.7)",
		cardBorder: "#0066aa",
		shadowColor: "rgba(0,255,255,0.2)",
	},
	minimal: {
		original: "#505050",
		vertuo: "#909090",
		background: "linear-gradient(180deg, rgba(28,28,28,0.95) 0%, rgba(18,18,18,0.98) 100%)",
		grid: "#2a2a2a",
		axis: "#3a3a3a",
		text: "#707070",
		glowOriginal: false,
		glowVertuo: false,
		tooltipBg: "rgba(20,20,20,0.97)",
		tooltipBorder: "#505050",
		cardBg: "rgba(25,25,25,0.6)",
		cardBorder: "#333",
		shadowColor: "rgba(0,0,0,0.3)",
	},
	gradient: {
		original: "#f97316",
		vertuo: "#06b6d4",
		background: "linear-gradient(160deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.98) 50%, rgba(20,30,50,0.98) 100%)",
		grid: "#2d3a4f",
		axis: "#4a5a72",
		text: "#8a9ab8",
		glowOriginal: true,
		glowVertuo: true,
		tooltipBg: "rgba(15,23,42,0.98)",
		tooltipBorder: "#f97316",
		cardBg: "rgba(20,30,50,0.6)",
		cardBorder: "#3a4a60",
		shadowColor: "rgba(249,115,22,0.15)",
	},
	monochrome: {
		original: "#c0c0c0",
		vertuo: "#707070",
		background: "linear-gradient(180deg, rgba(22,22,22,0.95) 0%, rgba(12,12,12,0.98) 100%)",
		grid: "#2a2a2a",
		axis: "#3a3a3a",
		text: "#6a6a6a",
		glowOriginal: false,
		glowVertuo: false,
		tooltipBg: "rgba(18,18,18,0.97)",
		tooltipBorder: "#666",
		cardBg: "rgba(22,22,22,0.6)",
		cardBorder: "#333",
		shadowColor: "rgba(0,0,0,0.25)",
	},
};

const THEME_LABELS: Record<GraphTheme, string> = {
	classic: "☕ Classic",
	neon: "⚡ Neon",
	minimal: "◻️ Minimal",
	gradient: "🌊 Ocean",
	monochrome: "◐ Mono",
};

interface GraphPoint {
	x: number;
	y: number;
	value: number;
	date: string;
	type: string;
	color: string;
}

interface ConsumptionGraphProps {
	data: any[];
	type: "capsules" | "machines";
	title: string;
	consumptionHistory: ConsumptionHistory | null;
	hoveredGraphPoint: GraphPoint | null;
	setHoveredGraphPoint: (point: GraphPoint | null) => void;
	accountId?: number;
	initialTheme?: GraphTheme;
}

export default function ConsumptionGraph({
	data,
	type,
	title,
	consumptionHistory,
	hoveredGraphPoint,
	setHoveredGraphPoint,
	accountId,
	initialTheme = "classic",
}: ConsumptionGraphProps) {
	const [theme, setTheme] = useState<GraphTheme>(initialTheme);
	const colors = THEMES[theme];

	// Save theme preference to database
	const saveThemePreference = async (newTheme: GraphTheme) => {
		if (!accountId) return;
		try {
			await fetch("http://localhost:4000/api/accounts/preferences", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ accountId, graph_theme: newTheme }),
			});
		} catch (err) {
			console.error("Failed to save theme preference:", err);
		}
	};

	const handleThemeChange = (newTheme: GraphTheme) => {
		setTheme(newTheme);
		saveThemePreference(newTheme);
	};

	if (!data || data.length === 0) {
		return (
			<div style={{ 
				color: "#666", 
				textAlign: "center", 
				padding: "2rem",
				background: "rgba(0,0,0,0.2)",
				borderRadius: "12px",
				margin: "0 auto",
				maxWidth: "580px",
			}}>
				No data available
			</div>
		);
	}

	// 10% larger dimensions with proper spacing for centered layout
	const width = 580;
	const height = 290;
	const paddingTop = 60;
	const paddingBottom = 50;
	const paddingLeft = 55;
	const paddingRight = 30;
	const graphWidth = width - paddingLeft - paddingRight;
	const graphHeight = height - paddingTop - paddingBottom;

	// Calculate scales
	const minDate = new Date(consumptionHistory?.accountCreatedAt || new Date()).getTime();
	const maxDate = new Date().getTime();
	const timeRange = Math.max(maxDate - minDate, 24 * 60 * 60 * 1000);

	const getVal = (d: any, key: string) => Number(d[key] || 0);

	const maxVal = Math.max(
		...data.map((d) => Math.max(getVal(d, `original_${type}`), getVal(d, `vertuo_${type}`))),
		type === "capsules" ? 50 : 1
	);

	const getX = (dateStr: string) => {
		const t = new Date(dateStr).getTime();
		return paddingLeft + ((t - minDate) / timeRange) * graphWidth;
	};

	const getY = (val: number) => {
		return height - paddingBottom - (val / maxVal) * graphHeight;
	};

	// Smooth path generator
	const getSmoothPath = (points: { x: number; y: number }[]) => {
		if (points.length === 0) return "";
		if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

		let d = `M ${points[0].x} ${points[0].y}`;
		for (let i = 0; i < points.length - 1; i++) {
			const p0 = points[i === 0 ? 0 : i - 1];
			const p1 = points[i];
			const p2 = points[i + 1];
			const p3 = points[i + 2] || p2;

			const cp1x = p1.x + (p2.x - p0.x) / 6;
			const cp1y = p1.y + (p2.y - p0.y) / 6;
			const cp2x = p2.x - (p3.x - p1.x) / 6;
			const cp2y = p2.y - (p3.y - p1.y) / 6;

			d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
		}
		return d;
	};

	const originalPoints = data.map((d) => ({
		x: getX(d.date),
		y: getY(getVal(d, `original_${type}`)),
	}));
	const vertuoPoints = data.map((d) => ({
		x: getX(d.date),
		y: getY(getVal(d, `vertuo_${type}`)),
	}));

	const originalPath = getSmoothPath(originalPoints);
	const vertuoPath = getSmoothPath(vertuoPoints);

	// Area paths (close the loop)
	const originalArea = `${originalPath} L ${originalPoints[originalPoints.length - 1].x} ${height - paddingBottom} L ${
		originalPoints[0].x
	} ${height - paddingBottom} Z`;
	const vertuoArea = `${vertuoPath} L ${vertuoPoints[vertuoPoints.length - 1].x} ${height - paddingBottom} L ${
		vertuoPoints[0].x
	} ${height - paddingBottom} Z`;

	return (
		<div style={{ 
			marginBottom: "2.5rem",
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			width: "100%",
			maxWidth: "620px",
		}}>
			{/* Theme Selector */}
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					gap: "0.5rem",
					marginBottom: "1.2rem",
					flexWrap: "wrap",
					padding: "0.75rem 1rem",
					background: colors.cardBg,
					borderRadius: "10px",
					border: `1px solid ${colors.cardBorder}`,
					boxShadow: `0 4px 16px ${colors.shadowColor}`,
				}}
			>
				{(Object.keys(THEMES) as GraphTheme[]).map((t) => (
					<button
						key={t}
						onClick={() => handleThemeChange(t)}
						style={{
							padding: "0.5rem 1rem",
							fontSize: "0.75rem",
							borderRadius: "8px",
							border: theme === t ? `2px solid ${THEMES[t].original}` : "1px solid transparent",
							background: theme === t 
								? `linear-gradient(135deg, ${THEMES[t].original}20, ${THEMES[t].original}10)` 
								: "rgba(40,40,40,0.5)",
							color: theme === t ? THEMES[t].original : "#888",
							cursor: "pointer",
							transition: "all 0.3s ease",
							fontWeight: theme === t ? 600 : 400,
							boxShadow: theme === t 
								? `0 0 20px ${THEMES[t].original}25, inset 0 0 20px ${THEMES[t].original}10` 
								: "none",
							transform: theme === t ? "scale(1.05)" : "scale(1)",
						}}
					>
						{THEME_LABELS[t]}
					</button>
				))}
			</div>

			<h3
				style={{
					fontSize: "0.85rem",
					textTransform: "uppercase",
					letterSpacing: "2.5px",
					color: colors.text,
					marginBottom: "1rem",
					textAlign: "center",
					fontWeight: 600,
					textShadow: colors.glowOriginal ? `0 0 10px ${colors.shadowColor}` : "none",
				}}
			>
				{title}
			</h3>

			{/* Graph */}
			<div
				style={{
					width: "100%",
					position: "relative",
				}}
			>
				<svg
					viewBox={`0 0 ${width} ${height}`}
					preserveAspectRatio="xMidYMid meet"
					style={{
						width: "100%",
						height: "auto",
						backgroundImage: colors.background,
						borderRadius: "12px",
						display: "block",
						boxShadow: `inset 0 2px 10px rgba(0,0,0,0.3), 0 4px 20px ${colors.shadowColor}`,
					}}
				>
					<defs>
						{/* Enhanced glow filters */}
						<filter id={`glow-original-${theme}`} x="-100%" y="-100%" width="300%" height="300%">
							<feGaussianBlur stdDeviation="4" result="blur1" />
							<feGaussianBlur stdDeviation="2" result="blur2" />
							<feMerge>
								<feMergeNode in="blur1" />
								<feMergeNode in="blur2" />
								<feMergeNode in="SourceGraphic" />
							</feMerge>
						</filter>
						<filter id={`glow-vertuo-${theme}`} x="-100%" y="-100%" width="300%" height="300%">
							<feGaussianBlur stdDeviation="4" result="blur1" />
							<feGaussianBlur stdDeviation="2" result="blur2" />
							<feMerge>
								<feMergeNode in="blur1" />
								<feMergeNode in="blur2" />
								<feMergeNode in="SourceGraphic" />
							</feMerge>
						</filter>
						{/* Point shadow filter */}
						<filter id={`point-shadow-${theme}`} x="-50%" y="-50%" width="200%" height="200%">
							<feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.4" />
						</filter>
						{/* Enhanced gradients */}
						<linearGradient id={`grad-original-${theme}`} x1="0%" y1="0%" x2="0%" y2="100%">
							<stop offset="0%" stopColor={colors.original} stopOpacity="0.35" />
							<stop offset="50%" stopColor={colors.original} stopOpacity="0.15" />
							<stop offset="100%" stopColor={colors.original} stopOpacity="0" />
						</linearGradient>
						<linearGradient id={`grad-vertuo-${theme}`} x1="0%" y1="0%" x2="0%" y2="100%">
							<stop offset="0%" stopColor={colors.vertuo} stopOpacity="0.35" />
							<stop offset="50%" stopColor={colors.vertuo} stopOpacity="0.15" />
							<stop offset="100%" stopColor={colors.vertuo} stopOpacity="0" />
						</linearGradient>
						{/* Line gradients for depth */}
						<linearGradient id={`line-original-${theme}`} x1="0%" y1="0%" x2="100%" y2="0%">
							<stop offset="0%" stopColor={colors.original} stopOpacity="0.8" />
							<stop offset="50%" stopColor={colors.original} stopOpacity="1" />
							<stop offset="100%" stopColor={colors.original} stopOpacity="0.8" />
						</linearGradient>
						<linearGradient id={`line-vertuo-${theme}`} x1="0%" y1="0%" x2="100%" y2="0%">
							<stop offset="0%" stopColor={colors.vertuo} stopOpacity="0.8" />
							<stop offset="50%" stopColor={colors.vertuo} stopOpacity="1" />
							<stop offset="100%" stopColor={colors.vertuo} stopOpacity="0.8" />
						</linearGradient>
					</defs>

					{/* Grid lines & Y Axis Labels */}
					{[0, 0.25, 0.5, 0.75, 1].map((p) => {
						const y = height - paddingBottom - p * graphHeight;
						const val = Math.round(p * maxVal);
						return (
							<g key={p}>
								<line
									x1={paddingLeft}
									y1={y}
									x2={width - paddingRight}
									y2={y}
									stroke={colors.grid}
									strokeDasharray={p === 0 ? "0" : "6 4"}
									strokeWidth={p === 0 ? "1.5" : "0.75"}
									opacity={p === 0 ? 1 : 0.6}
								/>
								<text
									x={paddingLeft - 12}
									y={y + 4}
									fill={colors.text}
									fontSize="10"
									textAnchor="end"
									fontWeight="500"
									opacity={0.9}
								>
									{val}
								</text>
							</g>
						);
					})}

					{/* X Axis Labels */}
					{[0, 0.25, 0.5, 0.75, 1].map((p) => {
						const x = paddingLeft + p * graphWidth;
						const t = minDate + p * timeRange;
						const date = new Date(t).toLocaleDateString(undefined, {
							month: "short",
							day: "numeric",
						});
						// Add subtle vertical grid lines
						return (
							<g key={p}>
								{p > 0 && p < 1 && (
									<line
										x1={x}
										y1={paddingTop}
										x2={x}
										y2={height - paddingBottom}
										stroke={colors.grid}
										strokeDasharray="4 6"
										strokeWidth="0.5"
										opacity="0.4"
									/>
								)}
								<text
									x={x}
									y={height - paddingBottom + 20}
									fill={colors.text}
									fontSize="10"
									textAnchor="middle"
									fontWeight="500"
									opacity={0.9}
								>
									{date}
								</text>
							</g>
						);
					})}

					{/* Enhanced Axes */}
					<line
						x1={paddingLeft}
						y1={height - paddingBottom}
						x2={width - paddingRight}
						y2={height - paddingBottom}
						stroke={colors.axis}
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
					<line
						x1={paddingLeft}
						y1={paddingTop}
						x2={paddingLeft}
						y2={height - paddingBottom}
						stroke={colors.axis}
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
					{/* Axis corner accent */}
					<circle
						cx={paddingLeft}
						cy={height - paddingBottom}
						r="3"
						fill={colors.axis}
					/>

					{/* Areas with enhanced gradients */}
					<path d={originalArea} fill={`url(#grad-original-${theme})`} />
					<path d={vertuoArea} fill={`url(#grad-vertuo-${theme})`} />

					{/* Lines with gradient stroke */}
					<path
						d={originalPath}
						fill="none"
						stroke={`url(#line-original-${theme})`}
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
						filter={colors.glowOriginal ? `url(#glow-original-${theme})` : undefined}
					/>
					<path
						d={vertuoPath}
						fill="none"
						stroke={`url(#line-vertuo-${theme})`}
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
						filter={colors.glowVertuo ? `url(#glow-vertuo-${theme})` : undefined}
					/>

					{/* Interactive Points with enhanced styling */}
					{data.map((d, i) => {
						const valOrig = getVal(d, `original_${type}`);
						const valVert = getVal(d, `vertuo_${type}`);
						const x = getX(d.date);
						const yOrig = getY(valOrig);
						const yVert = getY(valVert);

						return (
							<g key={i}>
								{valOrig > 0 && (
									<>
										{/* Point shadow */}
										<circle
											cx={x}
											cy={yOrig + 2}
											r="5"
											fill="rgba(0,0,0,0.3)"
											style={{ filter: "blur(2px)" }}
										/>
										<circle
											cx={x}
											cy={yOrig}
											r="6"
											fill={colors.original}
											stroke="#fff"
											strokeWidth="2.5"
											filter={`url(#point-shadow-${theme})`}
											onMouseEnter={() =>
												setHoveredGraphPoint({
													x,
													y: yOrig,
													value: valOrig,
													date: d.date,
													type: "Original",
													color: colors.original,
												})
											}
											onMouseLeave={() => setHoveredGraphPoint(null)}
											style={{ 
												cursor: "pointer", 
												transition: "transform 0.2s ease, r 0.2s ease",
											}}
										/>
									</>
								)}
								{valVert > 0 && (
									<>
										{/* Point shadow */}
										<circle
											cx={x}
											cy={yVert + 2}
											r="5"
											fill="rgba(0,0,0,0.3)"
											style={{ filter: "blur(2px)" }}
										/>
										<circle
											cx={x}
											cy={yVert}
											r="6"
											fill={colors.vertuo}
											stroke="#fff"
											strokeWidth="2.5"
											filter={`url(#point-shadow-${theme})`}
											onMouseEnter={() =>
												setHoveredGraphPoint({
													x,
													y: yVert,
													value: valVert,
													date: d.date,
													type: "Vertuo",
													color: colors.vertuo,
												})
											}
											onMouseLeave={() => setHoveredGraphPoint(null)}
											style={{ 
												cursor: "pointer", 
												transition: "transform 0.2s ease, r 0.2s ease",
											}}
										/>
									</>
								)}
							</g>
						);
					})}

					{/* Enhanced Tooltip */}
					{hoveredGraphPoint &&
						(() => {
							const tooltipWidth = 120;
							const tooltipHeight = 58;
							let tooltipX = hoveredGraphPoint.x;
							let tooltipY = hoveredGraphPoint.y - 15;

							// Flip below if near top
							if (tooltipY - tooltipHeight < 10) {
								tooltipY = hoveredGraphPoint.y + 20 + tooltipHeight;
							}

							// Clamp X
							const minX = tooltipWidth / 2 + 10;
							const maxX = width - tooltipWidth / 2 - 10;
							tooltipX = Math.max(minX, Math.min(maxX, tooltipX));

							return (
								<g transform={`translate(${tooltipX}, ${tooltipY})`}>
									{/* Tooltip shadow */}
									<rect
										x={-tooltipWidth / 2 + 3}
										y={-tooltipHeight + 3}
										width={tooltipWidth}
										height={tooltipHeight}
										rx="8"
										fill="rgba(0,0,0,0.4)"
										style={{ filter: "blur(4px)" }}
									/>
									{/* Tooltip body */}
									<rect
										x={-tooltipWidth / 2}
										y={-tooltipHeight}
										width={tooltipWidth}
										height={tooltipHeight}
										rx="8"
										fill={colors.tooltipBg}
										stroke={hoveredGraphPoint.color}
										strokeWidth="2"
									/>
									{/* Color accent bar */}
									<rect
										x={-tooltipWidth / 2}
										y={-tooltipHeight}
										width="4"
										height={tooltipHeight}
										rx="8"
										fill={hoveredGraphPoint.color}
									/>
									<text
										x="0"
										y={-tooltipHeight + 18}
										fill={hoveredGraphPoint.color}
										fontSize="12"
										fontWeight="bold"
										textAnchor="middle"
									>
										{hoveredGraphPoint.type}
									</text>
									<text
										x="0"
										y={-tooltipHeight + 34}
										fill="#fff"
										fontSize="11"
										textAnchor="middle"
										fontWeight="600"
									>
										{hoveredGraphPoint.value} {type}
									</text>
									<text 
										x="0" 
										y={-tooltipHeight + 50} 
										fill="#888" 
										fontSize="10" 
										textAnchor="middle"
									>
										{new Date(hoveredGraphPoint.date).toLocaleDateString(undefined, {
											month: "short",
											day: "numeric",
											year: "numeric",
										})}
									</text>
								</g>
							);
						})()}
				</svg>
			</div>
		</div>
	);
}
