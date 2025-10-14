"use client";

import React from "react";
import { createPortal } from "react-dom";

const CAPSULE_OPTIONS = Array.from({ length: 11 }, (_, idx) => idx * 10);

export type AddCapsulesPopupProps = {
	open: boolean;
	productName: string;
	defaultValue?: number;
	onClose: () => void;
	onConfirm: (capsules: number) => void;
};

export default function AddCapsulesPopup({ open, productName, defaultValue = 10, onClose, onConfirm }: AddCapsulesPopupProps) {
	const [mounted, setMounted] = React.useState(false);
	const [shouldRender, setShouldRender] = React.useState(open);
	const [capsules, setCapsules] = React.useState(defaultValue);
	const [animateOpen, setAnimateOpen] = React.useState(false);
	const dialogRef = React.useRef<HTMLDivElement | null>(null);
	const titleId = React.useId();

	React.useEffect(() => {
		setMounted(true);
	}, []);

	React.useEffect(() => {
		setCapsules(defaultValue);
	}, [defaultValue, open]);

	React.useEffect(() => {
		let timeout: number | undefined;
		let frame: number | undefined;
		if (open) {
			setShouldRender(true);
			frame = window.requestAnimationFrame(() => {
				setAnimateOpen(true);
			});
		} else {
			setAnimateOpen(false);
			timeout = window.setTimeout(() => setShouldRender(false), 350);
		}
		return () => {
			if (timeout) {
				window.clearTimeout(timeout);
			}
			if (frame) {
				window.cancelAnimationFrame(frame);
			}
		};
	}, [open]);

	React.useEffect(() => {
		if (!open) return;

		const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);

		const frame = window.requestAnimationFrame(() => {
			dialogRef.current?.focus();
		});

		const { style } = document.body;
		const previousOverflow = style.overflow;
		style.overflow = "hidden";
		document.body.classList.add("capsules-popup-open");

		return () => {
			document.removeEventListener("keydown", onKeyDown);
			window.cancelAnimationFrame(frame);
			style.overflow = previousOverflow;
			document.body.classList.remove("capsules-popup-open");
			previousActive?.focus({ preventScroll: true });
		};
	}, [open, onClose]);

	const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
		if (event.target === event.currentTarget) {
			onClose();
		}
	};

	const handleConfirm = () => {
		onConfirm(capsules);
	};

	if (!mounted || !shouldRender) {
		return null;
	}

	const isVisible = open && animateOpen;

	return createPortal(
		<div
			className={`capsules-popup-backdrop${isVisible ? " visible" : ""}`}
			role="presentation"
			onMouseDown={handleBackdropMouseDown}
		>
			<div
				ref={dialogRef}
				className={`capsules-popup${isVisible ? " visible" : ""}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				aria-hidden={!open}
			>
				<header className="capsules-popup__header">
					<h2 id={titleId}>Choose capsules</h2>
					<button type="button" className="capsules-popup__close" onClick={onClose} aria-label="Close popup">
						<span aria-hidden="true">×</span>
					</button>
				</header>
				<p className="capsules-popup__subtitle">Select how many capsules of {productName} you'd like to add.</p>
				<ul className="capsules-popup__options" role="listbox" aria-label="Capsule quantity">
					{CAPSULE_OPTIONS.map((option) => {
						const isSelected = option === capsules;
						return (
							<li key={option}>
								<button
									type="button"
									role="option"
									aria-selected={isSelected}
									className={`capsules-popup__option${isSelected ? " selected" : ""}`}
									onClick={() => setCapsules(option)}
								>
									<span className="capsules-popup__option-label">{option} capsules</span>
									<span className="capsules-popup__option-note">
										{option === 0 ? "No sleeves" : `${option / 10} sleeve${option === 10 ? "" : "s"}`}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
				<div className="capsules-popup__actions">
					<button type="button" className="capsules-popup__button secondary" onClick={onClose}>
						Close
					</button>
					<button type="button" className="capsules-popup__button primary" onClick={handleConfirm}>
						OK
					</button>
				</div>
			</div>
		</div>,
		document.body
	);
}
