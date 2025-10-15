"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import emailjs from "@emailjs/browser";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";
import { buildPageHref } from "@/lib/pages";

type CardType = {
	name: string;
	code: string;
	security: number;
	pattern: RegExp;
	format: string;
	image: string;
};

const CARD_TYPES: Record<string, CardType> = {
	"American Express": {
		name: "American Express",
		code: "ax",
		security: 4,
		pattern: /^3[47]/,
		format: "xxxx xxxxxx xxxxx",
		image: "/deprecated/Payment/images/American_Express.png",
	},
	Visa: {
		name: "Visa",
		code: "vs",
		security: 3,
		pattern: /^4/,
		format: "xxxx xxxx xxxx xxxx",
		image: "/deprecated/Payment/images/Visa.png",
	},
	Discover: {
		name: "Discover",
		code: "ds",
		security: 3,
		pattern: /^6(?:011|5)/,
		format: "xxxx xxxx xxxx xxxx",
		image: "/deprecated/Payment/images/Discover.png",
	},
	Mastercard: {
		name: "Mastercard",
		code: "mc",
		security: 3,
		pattern: /^5[1-5]/,
		format: "xxxx xxxx xxxx xxxx",
		image: "/deprecated/Payment/images/Mastercard.png",
	},
	Unknown: {
		name: "Unknown",
		code: "un",
		security: 3,
		pattern: /^$/,
		format: "xxxx xxxx xxxx xxxx",
		image: "",
	},
};

function formatCcNumber(ccNum: string, ccType: CardType | null): string {
	let numAppendedChars = 0;
	let formattedNumber = "";

	if (!ccType) {
		return ccNum;
	}

	const cardFormatString = ccType.format;

	for (let i = 0; i < ccNum.length; i++) {
		const cardFormatIndex = i + numAppendedChars;

		if (!cardFormatString || cardFormatIndex >= cardFormatString.length) {
			return ccNum;
		}

		if (cardFormatString.charAt(cardFormatIndex) !== "x") {
			numAppendedChars++;
			formattedNumber += cardFormatString.charAt(cardFormatIndex) + ccNum.charAt(i);
		} else {
			formattedNumber += ccNum.charAt(i);
		}
	}

	return formattedNumber;
}

function getCcType(ccNum: string): CardType | null {
	for (const i in CARD_TYPES) {
		const cardType = CARD_TYPES[i];

		if (ccNum.match(cardType.pattern)) {
			return cardType;
		}
	}
	return null;
}

function removeAllSpaces(str: string): string {
	return str.replace(/\s|&nbsp;/g, "");
}

function isUnsignedNumeric(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const charCode = value.charCodeAt(i);
		if (charCode < 48 || charCode > 57) {
			return false;
		}
	}
	return true;
}

// legacy glassmorphic alert options removed; notifications use the app provider

// Notifications are handled by the app-wide NotificationsProvider.
// The payment page will use the provider's `notify` function instead of
// the legacy DOM helper.

export default function PaymentPageContent() {
	const router = useRouter();
	const { reset } = useCart();
	const { notify } = useNotifications();

	// ensure the user came here via the place-order OK action
	const pathname = usePathname();
	const mountedPathRef = useRef<string | null>(null);

	useEffect(() => {
		if (typeof window === "undefined") return;

		// read a timestamp token from sessionStorage — only accept if it's recent
		const tsRaw = window.sessionStorage.getItem("allow_payment_ts");
		const ts = tsRaw ? Number(tsRaw) : 0;
		const now = Date.now();
		const FIVE_MIN = 5 * 60 * 1000;

		if (!ts || Number.isNaN(ts) || now - ts > FIVE_MIN) {
			// token missing or expired — redirect back to home
			router.push(buildPageHref("home"));
			return;
		}

		// remember the pathname where payment mounted; we'll use this to detect
		// real navigations away from the payment page and only then clear the token.
		mountedPathRef.current = pathname;
	}, [router, pathname]);

	// Clear allow_payment only when the real route changes away from the
	// payment page (avoids React Strict Mode development double-mount/unmount
	// causing the value to be cleared immediately).
	useEffect(() => {
		if (typeof window === "undefined") return;
		const mounted = mountedPathRef.current;
		if (mounted && pathname !== mounted) {
			try {
				window.sessionStorage.removeItem("allow_payment_ts");
			} catch {
				/* ignore */
			}
		}
	}, [pathname]);

	const [ccNum, setCcNum] = useState("");
	const [ccType, setCcType] = useState<CardType | null>(null);
	const [ccSecurity, setCcSecurity] = useState(3);
	const [ccLength, setCcLength] = useState<number | undefined>(undefined);
	const [expiry, setExpiry] = useState("");
	const [cvv, setCvv] = useState("");

	const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const formatExpirySpacing = useCallback((value: string) => {
		const expirySpacelessRegex = /^\d{2}\/\d+$/;
		const isExpirySpaceless = expirySpacelessRegex.exec(value);

		if (isExpirySpaceless) {
			const parts = value.split("/");
			return `${parts[0]} / ${parts[1]}`;
		}
		return value;
	}, []);

	const formatCreditCard = useCallback((rawValue: string) => {
		const spacelessCc = rawValue.replace(/\D/g, "");
		const detectedType = getCcType(spacelessCc);

		if (detectedType) {
			setCcType(detectedType);
			setCcLength(detectedType.format.length);
			setCcSecurity(detectedType.security);
		} else {
			setCcType(null);
			setCcLength(undefined);
			setCcSecurity(3);
		}

		const formatted = formatCcNumber(spacelessCc, detectedType);
		setCcNum(formatted);
		return formatted;
	}, []);

	const handleCardInput = useCallback(
		(event: FormEvent<HTMLInputElement>) => {
			const target = event.currentTarget;
			formatCreditCard(target.value);
		},
		[formatCreditCard]
	);

	const handleExpiryChange = useCallback((event: FormEvent<HTMLInputElement>) => {
		const target = event.currentTarget;
		setExpiry(target.value);
	}, []);

	const handleExpiryKeyUp = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			const expiryMonthRegex = /^\d{2}$/;
			const expiryMonthSlashRegex = /^\d{2} \/$/;

			const isMonthEntered = expiryMonthRegex.exec(expiry);
			const isMonthSlashEntered = expiryMonthSlashRegex.exec(expiry);

			if (isMonthSlashEntered && event.key === "Backspace") {
				setExpiry((prev) => prev.slice(0, -3));
			} else if (isMonthEntered && event.key >= "0" && event.key <= "9") {
				setExpiry((prev) => `${prev} / `);
			}

			setExpiry((prev) => formatExpirySpacing(prev));
		},
		[expiry, formatExpirySpacing]
	);

	useEffect(() => {
		if (typeof document !== "undefined") {
			document.body.classList.add("payment-page-body");
			return () => {
				document.body.classList.remove("payment-page-body");
			};
		}
		return undefined;
	}, []);

	useEffect(() => {
		setExpiry((prev) => formatExpirySpacing(prev));
	}, [formatExpirySpacing]);

	useEffect(() => {
		return () => {
			if (redirectTimerRef.current) {
				clearTimeout(redirectTimerRef.current);
			}
			if (reloadTimerRef.current) {
				clearTimeout(reloadTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (ccType) {
			window.localStorage.setItem("cType", ccType.name);
		} else {
			window.localStorage.setItem("cType", "Unknown");
		}
	}, [ccType]);

	const getCardImage = useCallback(() => {
		if (ccType && ccType.image) {
			return ccType.image;
		}
		return null;
	}, [ccType]);

	const sendPaymentConfirmationEmail = useCallback(async () => {
		try {
			const userEmail = localStorage.getItem("mailValue");
			const userName = localStorage.getItem("nameValue");

			if (!userEmail) {
				console.error("User email not found.");
				return;
			}

			const itemsRaw = localStorage.getItem("myItems");
			const items = itemsRaw ? JSON.parse(itemsRaw) : [];

			emailjs.init("T-VQxrMdcr_OdDWSa");

			await emailjs.send(
				"service_c2nhc5y",
				"template_z6i4fwr",
				{
					to_email: userEmail,
					to_name: userName ?? "",
					items_list: items,
				},
				"T-VQxrMdcr_OdDWSa"
			);
		} catch (error) {
			console.error("Error sending email:", error);
		}
	}, []);

	const handlePayment = useCallback(async () => {
		const cType = localStorage.getItem("cType");
		const cardDigits = removeAllSpaces(ccNum);
		const cvvNumber = cvv;
		const paymentTotal = parseFloat(localStorage.getItem("currentSum") || "0.0");

		if (isUnsignedNumeric(cvvNumber) && cvvNumber.length >= 3) {
			localStorage.setItem("cvv_full", "1");
		} else {
			localStorage.setItem("cvv_full", "0");
		}

		const cvvFull = localStorage.getItem("cvv_full");

		if (localStorage.getItem("account_log") === "true") {
			if (cType === "Unknown") {
				notify("You need to enter a valid form of payment! For example a Visa card.", 5000, "error", "payment");
			} else if (cardDigits.length !== 16 && cardDigits.length !== 15 && cType !== "American Express") {
				notify(
					"You need to enter a card number formed of 16 digits or 15 digits if it is an American Express card!",
					5000,
					"error",
					"payment"
				);
			} else if (cvvFull === "0") {
				notify(
					"Your CVV code should be formed of 3 digits or 4 if it is an American Express card!",
					5000,
					"error",
					"payment"
				);
			} else {
				localStorage.setItem("currentSum", "0");
				localStorage.setItem("account_log", "false");

				// successful payment: clear allow_payment, notify for 4s, reset bag and redirect
				try {
					window.sessionStorage.removeItem("allow_payment_ts");
				} catch {}

				notify(
					`Your ${cType} card will be charged ${paymentTotal} RON, and the package will be delivered as soon as possible!`,
					4000,
					"success",
					"payment"
				);

				await sendPaymentConfirmationEmail();

				localStorage.removeItem("myItems");

				reset({ silent: true });

				redirectTimerRef.current = setTimeout(() => {
					router.push(buildPageHref("coffee"));
				}, 4300);
			}
		} else {
			// Offer navigation to account page
			notify("You need to log in or make an account with us first!", 8000, "error", "payment", {
				actions: [
					{
						id: "go-account",
						label: "OK",
						variant: "primary",
						onClick: () => router.push(buildPageHref("account")),
					},
					{
						id: "stay",
						label: "No",
						variant: "ghost",
					},
				],
				persist: true,
			});
		}

		localStorage.setItem("cNum_full", "0");
		localStorage.setItem("cvv_full", "0");
		localStorage.setItem("cType", "");

		reloadTimerRef.current = setTimeout(() => {
			window.location.reload();
		}, 5000);
	}, [ccNum, cvv, reset, router, sendPaymentConfirmationEmail, notify]);

	const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
	}, []);

	const cardLogo = getCardImage();

	return (
		<div className="payment-page-root">
			<div className="payment-logo">
				<Link href={buildPageHref("home")}>
					<Image src="/images/Logo_filspresso_web.png" alt="Filspresso" width={260} height={120} priority />
				</Link>
			</div>
			<div className="payment-card">
				<form className="payment-form" autoComplete="off" onSubmit={handleSubmit}>
					<div className="payment-grid">
						<label htmlFor="cc" className="payment-field payment-span-3">
							<span className="payment-field__title">Card number</span>
							<p className="payment-field__helper">
								As a user types, the number should be formatted with spaces for legibility based on the pattern
								the type of card uses.
							</p>
							<div className="payment-input-wrapper">
								<input
									type="text"
									name="cc"
									id="cc"
									placeholder="XXXX XXXX XXXX XXXX"
									autoComplete="off"
									spellCheck={false}
									inputMode="numeric"
									value={ccNum}
									onInput={handleCardInput}
									onKeyUp={handleCardInput}
									maxLength={ccLength}
									className="payment-input"
								/>
								{cardLogo ? (
									<span className="payment-card-brand">
										<Image src={cardLogo} alt="Credit Card Logo" width={72} height={32} />
									</span>
								) : null}
							</div>
						</label>
						<label htmlFor="expiry" className="payment-field payment-span-2">
							<span className="payment-field__title">Expiration date</span>
							<p className="payment-field__helper">
								As a user types, a slash should automatically be added once a month is entered. If no year is
								present and the user hits backspace, it should delete the slash and the second digit of the month
							</p>
							<div className="payment-input-wrapper">
								<input
									type="text"
									name="expiry"
									id="expiry"
									maxLength={9}
									placeholder="MM / YYYY"
									autoComplete="off"
									spellCheck={false}
									inputMode="numeric"
									value={expiry}
									onInput={handleExpiryChange}
									onKeyUp={handleExpiryKeyUp}
									className="payment-input"
								/>
							</div>
						</label>
						<label htmlFor="cvv" className="payment-field payment-span-1">
							<span className="payment-field__title">CVV</span>
							<p className="payment-field__helper">
								The max length of this field should be 3 for most card types, 4 for American Express
							</p>
							<div className="payment-input-wrapper">
								<input
									type="text"
									name="cvv"
									id="cvv"
									maxLength={ccSecurity}
									placeholder="CVV"
									autoComplete="off"
									spellCheck={false}
									inputMode="numeric"
									value={cvv}
									onInput={(event) => {
										const target = event.currentTarget;
										setCvv(target.value.replace(/\D/g, "").slice(0, ccSecurity));
									}}
									className="payment-input"
								/>
							</div>
						</label>
					</div>
				</form>
				<button type="button" onClick={handlePayment} id="pay" className="payment-pay-button">
					Pay
				</button>
			</div>
			<div className="payment-built-with">
				<p>build with</p>
				<div className="payment-built-with__brands">
					<svg width="192" height="24" viewBox="0 0 262 33" xmlns="http://www.w3.org/2000/svg">
						<path
							fill="#06B6D4"
							d="M27 0c-7.2 0-11.7 3.6-13.5 10.8 2.7-3.6 5.85-4.95 9.45-4.05 2.054.513 3.522 2.004 5.147 3.653C30.744 13.09 33.808 16.2 40.5 16.2c7.2 0 11.7-3.6 13.5-10.8-2.7 3.6-5.85 4.95-9.45 4.05-2.054-.513-3.522-2.004-5.147-3.653C36.756 3.11 33.692 0 27 0zM13.5 16.2C6.3 16.2 1.8 19.8 0 27c2.7-3.6 5.85-4.95 9.45-4.05 2.054.514 3.522 2.004 5.147 3.653C17.244 29.29 20.308 32.4 27 32.4c7.2 0 11.7-3.6 13.5-10.8-2.7 3.6-5.85 4.95-9.45 4.05-2.054-.513-3.522-2.004-5.147-3.653C23.256 19.31 20.192 16.2 13.5 16.2z"
						/>
						<text
							x="64"
							y="30"
							textAnchor="start"
							style={{
								fontSize: "36px",
								fontFamily: "Poppins-SemiBold, Poppins",
								fontWeight: 600,
								letterSpacing: "-0.05rem",
							}}
						>
							tailwindcss
						</text>
					</svg>
					<svg width="148" height="24" viewBox="0 0 148 24" xmlns="http://www.w3.org/2000/svg">
						<path fill="#77c1d2" d="M30.46.49l8.7,8.67-8.7,8.66-8.7-8.66Z" />
						<path fill="#2d3441" d="M8.7.49l18,18H9.34L0,9.16Z" />
						<text style={{ fontSize: "1.15rem", fontWeight: 800 }} x="48" y="16" textAnchor="start">
							Alpine.js
						</text>
					</svg>
				</div>
			</div>
		</div>
	);
}
