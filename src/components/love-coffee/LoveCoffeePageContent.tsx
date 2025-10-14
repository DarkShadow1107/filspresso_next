"use client";

import { useMemo, useState, type ReactNode } from "react";

const baseOptions = [
	"Black",
	"Flat White",
	"Latte",
	"Cappuccino",
	"Americano",
	"Espresso",
	"Doppio",
	"Cortado",
	"Macchiato",
	"Mocha",
	"Affogato",
	"Con Panna",
	"Irish",
	"Cafe Au Lait",
];

const cortadoIndex = baseOptions.indexOf("Cortado");
const rotationTailLength = cortadoIndex >= 0 ? cortadoIndex + 1 : baseOptions.length;
const rotatingOptions = [...baseOptions, ...baseOptions, ...baseOptions.slice(0, rotationTailLength)];

function formatOption(option: string) {
	return option.toLowerCase().replace(/\s+/g, "-");
}

const segmentLabels: { className: string; label: ReactNode }[] = [
	{ className: "gelato", label: "gelato" },
	{ className: "foam", label: "milk foam" },
	{ className: "cream", label: "cream" },
	{ className: "steamed-milk", label: "steamed milk" },
	{ className: "milk", label: "milk" },
	{ className: "chocolate", label: "chocolate" },
	{ className: "sugar", label: "sugar" },
	{ className: "whiskey", label: "whiskey" },
	{ className: "water", label: "water" },
	{ className: "coffee", label: "coffee" },
	{
		className: "espresso",
		label: (
			<>
				<span>(2)&nbsp;</span> espresso
			</>
		),
	},
];

export default function LoveCoffeePageContent() {
	const [selected, setSelected] = useState<string>("Latte");
	const selectedClass = useMemo(() => formatOption(selected), [selected]);

	return (
		<main className="love-coffee-page">
			<div className="love-coffee-root">
				<div className="options">
					{rotatingOptions.map((option, idx) => (
						<div key={`${option}-${idx}`} onClick={() => setSelected(option)}>
							{option}
						</div>
					))}
				</div>
				<div className="wrapper">
					<div className="shadow" />
					<div className="title">{selected}</div>
					<div className={`cup ${selectedClass}`}>
						<div className="contents">
							{segmentLabels.map((segment) => (
								<div key={segment.className} className={segment.className}>
									{segment.label}
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</main>
	);
}
