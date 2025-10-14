"use client";

import { useCallback, useState, type MouseEvent } from "react";

type Operator = "plus" | "minus" | "times" | "divided by";

const operatorLabels: Record<Operator, string> = {
	plus: "plus",
	minus: "minus",
	times: "times",
	"divided by": "divided by",
};

type CalcButton = {
	label: string;
	type: "number" | "operator" | "equals";
	value?: string;
	operator?: Operator;
};

const buttons: CalcButton[] = [
	{ label: "7", type: "number", value: "7" },
	{ label: "8", type: "number", value: "8" },
	{ label: "9", type: "number", value: "9" },
	{ label: "+", type: "operator", operator: "plus" },
	{ label: "4", type: "number", value: "4" },
	{ label: "5", type: "number", value: "5" },
	{ label: "6", type: "number", value: "6" },
	{ label: "-", type: "operator", operator: "minus" },
	{ label: "1", type: "number", value: "1" },
	{ label: "2", type: "number", value: "2" },
	{ label: "3", type: "number", value: "3" },
	{ label: "×", type: "operator", operator: "times" },
	{ label: "0", type: "number", value: "0" },
	{ label: ".", type: "number", value: "." },
	{ label: "=", type: "equals" },
	{ label: "÷", type: "operator", operator: "divided by" },
];

export default function ShopCalculatorPageContent() {
	const [theNum, setTheNum] = useState<string>("");
	const [oldNum, setOldNum] = useState<string>("");
	const [operator, setOperator] = useState<Operator | null>(null);
	const [resultNum, setResultNum] = useState<string | null>(null);
	const [viewer, setViewer] = useState<string>("0");
	const [equalsData, setEqualsData] = useState<string>("");
	const [isBroken, setIsBroken] = useState(false);
	const [showReset, setShowReset] = useState(false);

	const handleNumber = useCallback(
		(digit: string) => {
			if (isBroken) return;
			setTheNum((prev) => {
				const hasResult = resultNum !== null;
				const base = hasResult ? "" : prev;
				const next = `${base}${digit}`;
				setViewer(next !== "" ? next : "0");
				return next;
			});
			if (resultNum !== null) {
				setResultNum(null);
			}
		},
		[isBroken, resultNum]
	);

	const handleOperatorClick = useCallback(
		(nextOperator: Operator) => {
			if (isBroken) return;
			setOldNum(theNum);
			setTheNum("");
			setOperator(nextOperator);
			setResultNum(null);
			setEqualsData("");
		},
		[isBroken, theNum]
	);

	const handleEquals = useCallback(() => {
		if (isBroken) return;
		const first = parseFloat(oldNum);
		const second = parseFloat(theNum);
		let result: number | string;
		let encounteredError = false;

		switch (operator) {
			case "plus":
				result = first + second;
				break;
			case "minus":
				result = first - second;
				break;
			case "times":
				result = first * second;
				break;
			case "divided by":
				result = first / second;
				break;
			default:
				result = second;
		}

		if (typeof result === "number" && !Number.isFinite(result)) {
			if (Number.isNaN(result)) {
				result = "You broke it!";
			} else {
				result = "Look at what you've done";
			}
			encounteredError = true;
		}

		if (typeof result === "string" && (result === "You broke it!" || result === "Look at what you've done")) {
			encounteredError = true;
		}

		const resultString = typeof result === "number" ? result.toString() : result;
		setViewer(resultString);
		setEqualsData(resultString);
		setOldNum("0");
		setTheNum(resultString);
		setResultNum(resultString);
		setOperator(null);

		if (encounteredError) {
			setIsBroken(true);
			setShowReset(true);
		}
	}, [isBroken, oldNum, operator, theNum]);

	const handleClear = useCallback(() => {
		if (isBroken) return;
		setOldNum("");
		setTheNum("");
		setOperator(null);
		setViewer("0");
		setEqualsData(resultNum ?? "");
		setResultNum(null);
	}, [isBroken, resultNum]);

	const handleReset = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
		event.preventDefault();
		setOldNum("");
		setTheNum("");
		setOperator(null);
		setViewer("0");
		setEqualsData("");
		setResultNum(null);
		setIsBroken(false);
		setShowReset(false);
	}, []);

	return (
		<section className="shop-calculator-page">
			<h1>Shop Calculator</h1>
			<p className="warning">Don&apos;t divide by zero</p>
			<div
				id="calculator"
				className={`calculator${isBroken ? " broken" : ""}`}
				aria-live="polite"
				aria-hidden={showReset ? true : undefined}
			>
				<button id="clear" type="button" className="clear" onClick={handleClear} data-num="clear" disabled={isBroken}>
					C
				</button>
				<div id="viewer" className="viewer" role="status" aria-live="polite">
					{viewer}
				</div>
				{buttons.map((button, index) => {
					if (button.type === "number") {
						return (
							<button
								key={`btn-${button.label}-${index}`}
								type="button"
								className="num"
								data-num={button.value}
								onClick={() => handleNumber(button.value!)}
								disabled={isBroken}
							>
								{button.label}
							</button>
						);
					}
					if (button.type === "operator") {
						return (
							<button
								key={`btn-op-${button.label}`}
								type="button"
								className="ops"
								data-ops={button.operator ? operatorLabels[button.operator] : undefined}
								onClick={() => handleOperatorClick(button.operator!)}
								disabled={isBroken}
							>
								{button.label}
							</button>
						);
					}
					return (
						<button
							id="equals"
							key="btn-equals"
							type="button"
							className="equals"
							data-result={equalsData}
							onClick={handleEquals}
							disabled={isBroken}
						>
							=
						</button>
					);
				})}
			</div>
			<a
				id="reset"
				className={`reset${showReset ? " show" : ""}`}
				href="#reset-calculator"
				target="_top"
				onClick={handleReset}
			>
				Reset Work?
			</a>
		</section>
	);
}
