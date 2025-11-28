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
		image: "/images/Payment/American_Express.png",
	},
	Visa: {
		name: "Visa",
		code: "vs",
		security: 3,
		pattern: /^4/,
		format: "xxxx xxxx xxxx xxxx",
		image: "/images/Payment/Visa.png",
	},
	Discover: {
		name: "Discover",
		code: "ds",
		security: 3,
		pattern: /^6(?:011|5)/,
		format: "xxxx xxxx xxxx xxxx",
		image: "/images/Payment/Discover.png",
	},
	Mastercard: {
		name: "Mastercard",
		code: "mc",
		security: 3,
		pattern: /^5[1-5]/,
		format: "xxxx xxxx xxxx xxxx",
		image: "/images/Payment/Mastercard.png",
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
	const { items, currentSum, reset } = useCart();
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
	const [savedCards, setSavedCards] = useState<any[]>([]);
	const [selectedSavedCard, setSelectedSavedCard] = useState<any | null>(null);
	const [shouldSaveCard, setShouldSaveCard] = useState(false);
	const [isCardDropdownOpen, setIsCardDropdownOpen] = useState(false);

	useEffect(() => {
		// Fetch saved cards from Express API
		const session = sessionStorage.getItem("account_session");
		if (session) {
			try {
				const { token } = JSON.parse(session);
				if (token) {
					fetch("http://localhost:4000/api/cards", {
						headers: { Authorization: `Bearer ${token}` },
					})
						.then((res) => res.json())
						.then((data) => {
							if (data.cards && Array.isArray(data.cards)) {
								setSavedCards(data.cards);
							}
						})
						.catch((err) => console.error("Failed to load cards", err));
				}
			} catch (e) {
				console.error("Failed to parse session", e);
			}
		}
	}, []);

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

	const handleSelectCard = useCallback(
		(cardId: string) => {
			if (!cardId) {
				// Clear selection
				setSelectedSavedCard(null);
				setCcNum("");
				setExpiry("");
				setCvv("");
				setCcType(null);
				return;
			}

			const card = savedCards.find((c) => c.id === parseInt(cardId));
			if (card) {
				setSelectedSavedCard(card);
				// Format the card number display (masked)
				const maskedNumber = `•••• •••• •••• ${card.card_last_four}`;
				setCcNum(maskedNumber);
				setExpiry(card.card_expiry);
				// Set card type based on card_type from database
				const cardTypeName = card.card_type || "Visa";
				let normalizedType = "Visa";
				const lowerType = cardTypeName.toLowerCase();
				if (lowerType.includes("visa")) normalizedType = "Visa";
				else if (lowerType.includes("master")) normalizedType = "Mastercard";
				else if (lowerType.includes("american") || lowerType.includes("amex")) normalizedType = "American Express";
				else if (lowerType.includes("discover")) normalizedType = "Discover";

				const detectedType = CARD_TYPES[normalizedType] || CARD_TYPES["Visa"];
				setCcType(detectedType);
				setCcSecurity(detectedType.security);
				// Pre-fill CVV if available from saved card
				if (card.card_cvv) {
					setCvv(card.card_cvv);
					notify("Card selected! Ready to pay.", 3000, "success", "payment");
				} else {
					setCvv("");
					notify("Card selected! Please enter your CVV to continue.", 4000, "info", "payment");
				}
			}
		},
		[savedCards, notify]
	);

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

		// Store card type in sessionStorage instead of localStorage
		if (ccType) {
			window.sessionStorage.setItem("cType", ccType.name);
		} else {
			window.sessionStorage.setItem("cType", "Unknown");
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
			const session = sessionStorage.getItem("account_session");
			if (!session) {
				console.error("User session not found.");
				return;
			}

			const account = JSON.parse(session);
			const userEmail = account.email;
			const userName = account.full_name || account.username;

			if (!userEmail) {
				console.error("User email not found.");
				return;
			}

			emailjs.init("T-VQxrMdcr_OdDWSa");

			await emailjs.send(
				"service_c2nhc5y",
				"template_z6i4fwr",
				{
					to_email: userEmail,
					to_name: userName ?? "",
					items_list: [],
				},
				"T-VQxrMdcr_OdDWSa"
			);
		} catch (error) {
			console.error("Error sending email:", error);
		}
	}, []);

	const handlePayment = useCallback(async () => {
		const cType = sessionStorage.getItem("cType") || (selectedSavedCard ? selectedSavedCard.card_type : null);
		const cardDigits = removeAllSpaces(ccNum);
		const cvvNumber = cvv;

		// Calculate shipping and total
		const shippingCost = currentSum >= 200 ? 0 : 24.99;
		const paymentTotal = currentSum + shippingCost;

		// Check session storage for login state
		const session = sessionStorage.getItem("account_session");
		const isLoggedIn = !!session;

		if (isLoggedIn) {
			// Validation for saved card
			if (selectedSavedCard) {
				if (!(isUnsignedNumeric(cvvNumber) && cvvNumber.length >= 3)) {
					notify("Please enter your CVV to confirm payment with your saved card.", 5000, "error", "payment");
					return;
				}
			} else {
				// Validation for new card
				if (cType === "Unknown" || !cType) {
					notify("You need to enter a valid form of payment! For example a Visa card.", 5000, "error", "payment");
					return;
				} else if (cardDigits.length !== 16 && cardDigits.length !== 15 && cType !== "American Express") {
					notify(
						"You need to enter a card number formed of 16 digits or 15 digits if it is an American Express card!",
						5000,
						"error",
						"payment"
					);
					return;
				} else if (!(isUnsignedNumeric(cvvNumber) && cvvNumber.length >= 3)) {
					notify(
						"Your CVV code should be formed of 3 digits or 4 if it is an American Express card!",
						5000,
						"error",
						"payment"
					);
					return;
				}
			}

			// Successful payment
			try {
				window.sessionStorage.removeItem("allow_payment_ts");
			} catch {}

			const accountData = JSON.parse(session);
			const token = accountData.token;

			if (shouldSaveCard && !selectedSavedCard && token) {
				try {
					await fetch("http://localhost:4000/api/cards", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							cardNumber: cardDigits,
							expiry,
							cvv,
							cardType: cType,
							cardHolder: accountData.full_name || accountData.username || "Valued Customer",
						}),
					});
					notify("Card saved securely!", 3000, "success", "payment");
				} catch (e) {
					console.error("Failed to save card", e);
				}
			}

			// Check if this is a subscription purchase
			const subscriptionItem = items.find((item) => item.id.startsWith("sub-"));
			const isSubscriptionPurchase = !!subscriptionItem;

			if (isSubscriptionPurchase && subscriptionItem) {
				// Extract subscription details from item id (e.g., "sub-ultimate")
				const subscriptionTier = subscriptionItem.id.replace("sub-", "");
				const billingCycle = subscriptionItem.name.toLowerCase().includes("yearly") ? "annual" : "monthly";

				// Create subscription via API
				try {
					const subResponse = await fetch("http://localhost:4000/api/subscriptions", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							tier: subscriptionTier,
							billingCycle: billingCycle,
							cardId: selectedSavedCard?.id || null,
						}),
					});

					if (subResponse.ok) {
						const subData = await subResponse.json();
						const renewalDate = subData.subscription?.renewal_date
							? new Date(subData.subscription.renewal_date).toLocaleDateString("en-US", {
									weekday: "short",
									year: "numeric",
									month: "short",
									day: "numeric",
							  })
							: "";

						// Show subscription-specific notification (no delivery, confirmed immediately)
						notify(
							`🎉 Subscription confirmed! Your ${
								subscriptionTier.charAt(0).toUpperCase() + subscriptionTier.slice(1)
							} plan is now active. Next renewal: ${renewalDate}`,
							6000,
							"success",
							"payment"
						);

						// Also create an order record for the subscription
						try {
							await fetch("http://localhost:4000/api/orders", {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									Authorization: `Bearer ${token}`,
								},
								body: JSON.stringify({
									items: [
										{
											productId: subscriptionItem.id,
											productName: subscriptionItem.name,
											productType: "subscription",
											quantity: 1,
											unitPrice: subscriptionItem.price,
											productImage: null,
										},
									],
									shippingCost: 0,
									total: subscriptionItem.price,
									paymentMethod: cType || "Card",
									cardId: selectedSavedCard?.id || null,
									isSubscription: true,
								}),
							});
						} catch (e) {
							console.error("Failed to save subscription order", e);
						}

						// Update session storage with new subscription
						const updatedAccountData = {
							...accountData,
							subscription: subscriptionTier.charAt(0).toUpperCase() + subscriptionTier.slice(1),
						};
						sessionStorage.setItem("account_session", JSON.stringify(updatedAccountData));
					} else {
						notify("Subscription activation failed. Please contact support.", 5000, "error", "payment");
					}
				} catch (e) {
					console.error("Failed to create subscription", e);
					notify("Subscription activation failed. Please try again.", 5000, "error", "payment");
				}
			} else {
				// Regular product order
				notify(
					`Your ${cType} card will be charged ${paymentTotal.toFixed(
						2
					)} RON, and the package will be delivered as soon as possible!`,
					4000,
					"success",
					"payment"
				);

				// Save order to backend
				try {
					if (token && items.length > 0) {
						await fetch("http://localhost:4000/api/orders", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${token}`,
							},
							body: JSON.stringify({
								items: items.map((item) => ({
									productId: item.id,
									productName: item.name,
									productType: item.productType || "capsule",
									quantity: item.qty,
									unitPrice: item.price,
									productImage: item.image,
								})),
								shippingCost: shippingCost,
								total: paymentTotal,
								paymentMethod: cType || "Card",
								cardId: selectedSavedCard?.id || null,
							}),
						});
					}
				} catch (e) {
					console.error("Failed to save order", e);
				}
			}

			await sendPaymentConfirmationEmail();

			reset({ silent: true });

			redirectTimerRef.current = setTimeout(() => {
				router.push(buildPageHref("coffee"));
			}, 4300);
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

		sessionStorage.removeItem("cType");

		reloadTimerRef.current = setTimeout(() => {
			window.location.reload();
		}, 5000);
	}, [
		ccNum,
		cvv,
		currentSum,
		items,
		expiry,
		shouldSaveCard,
		selectedSavedCard,
		reset,
		router,
		sendPaymentConfirmationEmail,
		notify,
	]);

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
				{savedCards.length > 0 && (
					<div
						className="saved-cards-selector"
						style={{
							marginBottom: "2rem",
							position: "relative",
							zIndex: 20,
							width: "min(100%, 38rem)",
						}}
					>
						<div
							onClick={() => setIsCardDropdownOpen(!isCardDropdownOpen)}
							style={{
								background: "linear-gradient(145deg, #1a1a1a 0%, #0d0d0d 100%)",
								border: isCardDropdownOpen ? "1px solid #c4a77d" : "1px solid #333",
								borderRadius: "12px",
								padding: "1rem 1.25rem",
								cursor: "pointer",
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								transition: "all 0.3s ease",
								boxShadow: isCardDropdownOpen
									? "0 0 0 2px rgba(196, 167, 125, 0.2), 0 8px 24px rgba(0,0,0,0.4)"
									: "0 4px 12px rgba(0,0,0,0.2)",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
								<div
									style={{
										width: "36px",
										height: "36px",
										borderRadius: "10px",
										background: selectedSavedCard
											? "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)"
											: "#2a2a2a",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: "1.2rem",
										color: selectedSavedCard ? "#fff" : "#888",
									}}
								>
									{selectedSavedCard ? "💳" : "💳"}
								</div>
								<div>
									<div
										style={{
											color: selectedSavedCard ? "#c4a77d" : "#fff",
											fontWeight: 600,
											fontSize: "1rem",
											fontFamily: selectedSavedCard ? "'Courier New', monospace" : "inherit",
											letterSpacing: selectedSavedCard ? "1px" : "normal",
										}}
									>
										{selectedSavedCard
											? `•••• •••• •••• ${selectedSavedCard.card_last_four}`
											: "Select a saved card"}
									</div>
									<div style={{ color: "#888", fontSize: "0.8rem", marginTop: "2px" }}>
										{selectedSavedCard
											? `${selectedSavedCard.card_type} • Exp: ${selectedSavedCard.card_expiry}`
											: "Or enter details manually below"}
									</div>
								</div>
							</div>
							<div
								style={{
									transform: isCardDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
									transition: "transform 0.3s ease",
									color: "#888",
								}}
							>
								▼
							</div>
						</div>

						{/* Dropdown Menu */}
						{isCardDropdownOpen && (
							<div
								style={{
									position: "absolute",
									top: "calc(100% + 8px)",
									left: 0,
									right: 0,
									background: "#121212",
									border: "1px solid #333",
									borderRadius: "12px",
									overflow: "hidden",
									boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
									zIndex: 30,
									animation: "fadeIn 0.2s ease-out",
								}}
							>
								{savedCards.map((card) => (
									<div
										key={card.id}
										onClick={() => {
											handleSelectCard(card.id.toString());
											setIsCardDropdownOpen(false);
										}}
										style={{
											padding: "1rem 1.25rem",
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											cursor: "pointer",
											background: selectedSavedCard?.id === card.id ? "#1a1a1a" : "transparent",
											borderBottom: "1px solid #222",
											transition: "background 0.2s",
										}}
										onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
										onMouseLeave={(e) =>
											(e.currentTarget.style.background =
												selectedSavedCard?.id === card.id ? "#1a1a1a" : "transparent")
										}
									>
										<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
											<div
												style={{
													fontFamily: "'Courier New', monospace",
													color: "#fff",
													fontSize: "1rem",
													letterSpacing: "1px",
												}}
											>
												•••• {card.card_last_four}
											</div>
											<div
												style={{
													background: "#222",
													padding: "2px 8px",
													borderRadius: "4px",
													fontSize: "0.75rem",
													color: "#aaa",
												}}
											>
												{card.card_type}
											</div>
										</div>
										{selectedSavedCard?.id === card.id && <span style={{ color: "#c4a77d" }}>✓</span>}
									</div>
								))}

								<div
									onClick={() => {
										handleSelectCard("");
										setIsCardDropdownOpen(false);
									}}
									style={{
										padding: "1rem 1.25rem",
										display: "flex",
										alignItems: "center",
										gap: "0.75rem",
										cursor: "pointer",
										color: "#3b82f6",
										background: !selectedSavedCard ? "rgba(59, 130, 246, 0.05)" : "transparent",
									}}
									onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59, 130, 246, 0.1)")}
									onMouseLeave={(e) =>
										(e.currentTarget.style.background = !selectedSavedCard
											? "rgba(59, 130, 246, 0.05)"
											: "transparent")
									}
								>
									<span>✏️</span>
									<span style={{ fontWeight: 500 }}>Enter card details manually</span>
								</div>
							</div>
						)}
					</div>
				)}
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
									readOnly={!!selectedSavedCard}
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
								As a user types, a slash should automatically be added once a month is entered.
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
									readOnly={!!selectedSavedCard}
								/>
							</div>
						</label>
						<label htmlFor="cvv" className="payment-field payment-span-1">
							<span className="payment-field__title">
								CVV {selectedSavedCard && <span style={{ color: "#ef4444" }}>*</span>}
							</span>
							<p className="payment-field__helper">3 digits for most cards, 4 for Amex.</p>
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
						{!selectedSavedCard && (
							<div
								className="payment-span-3"
								style={{
									gridColumn: "span 3",
									marginTop: "2rem",
									position: "relative",
									overflow: "hidden",
									borderRadius: "16px",
									cursor: "pointer",
									transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
									background: shouldSaveCard
										? "linear-gradient(135deg, rgba(196, 167, 125, 0.15) 0%, rgba(166, 124, 82, 0.08) 100%)"
										: "linear-gradient(145deg, #151515 0%, #0a0a0a 100%)",
									border: shouldSaveCard ? "2px solid rgba(196, 167, 125, 0.5)" : "1px solid #2a2a2a",
									boxShadow: shouldSaveCard
										? "0 8px 32px rgba(196, 167, 125, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)"
										: "0 4px 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.03)",
									padding: "1.5rem 2rem", // Increased padding for wider/taller look
								}}
								onClick={() => setShouldSaveCard(!shouldSaveCard)}
								onMouseEnter={(e) => {
									if (!shouldSaveCard) {
										e.currentTarget.style.borderColor = "#444";
										e.currentTarget.style.transform = "translateY(-2px)";
										e.currentTarget.style.boxShadow =
											"0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.05)";
									}
								}}
								onMouseLeave={(e) => {
									if (!shouldSaveCard) {
										e.currentTarget.style.borderColor = "#2a2a2a";
										e.currentTarget.style.transform = "translateY(0)";
										e.currentTarget.style.boxShadow =
											"0 4px 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.03)";
									}
								}}
							>
								{/* Animated background shimmer */}
								{shouldSaveCard && (
									<div
										style={{
											position: "absolute",
											top: 0,
											left: "-100%",
											width: "200%",
											height: "100%",
											background:
												"linear-gradient(90deg, transparent 0%, rgba(196, 167, 125, 0.1) 50%, transparent 100%)",
											animation: "shimmer 2s infinite",
											pointerEvents: "none",
										}}
									/>
								)}

								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										position: "relative",
										zIndex: 1,
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
										{/* Card Icon with Shield */}
										<div
											style={{
												position: "relative",
												width: "64px", // Increased size
												height: "64px", // Increased size
											}}
										>
											<div
												style={{
													width: "64px",
													height: "64px",
													borderRadius: "16px",
													background: shouldSaveCard
														? "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)"
														: "linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													transition: "all 0.4s ease",
													boxShadow: shouldSaveCard
														? "0 4px 16px rgba(196, 167, 125, 0.4)"
														: "0 2px 8px rgba(0, 0, 0, 0.3)",
													border: shouldSaveCard ? "none" : "1px solid #333",
												}}
											>
												<span
													style={{
														fontSize: "2rem", // Increased font size
														transition: "transform 0.3s ease",
														transform: shouldSaveCard ? "scale(1.1)" : "scale(1)",
													}}
												>
													{shouldSaveCard ? "🔒" : "💳"}
												</span>
											</div>
											{/* Checkmark badge */}
											{shouldSaveCard && (
												<div
													style={{
														position: "absolute",
														bottom: "-6px",
														right: "-6px",
														width: "26px",
														height: "26px",
														borderRadius: "50%",
														background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														boxShadow: "0 2px 8px rgba(16, 185, 129, 0.5)",
														border: "3px solid #0a0a0a",
													}}
												>
													<span style={{ color: "#fff", fontSize: "0.8rem", fontWeight: 700 }}>✓</span>
												</div>
											)}
										</div>
										<div>
											<div
												style={{
													fontSize: "1.1rem", // Increased font size
													color: shouldSaveCard ? "#c4a77d" : "#fff",
													fontWeight: 700,
													marginBottom: "6px",
													letterSpacing: "0.02em",
												}}
											>
												{shouldSaveCard ? "Card will be saved securely" : "Save card for faster checkout"}
											</div>
											<div
												style={{
													fontSize: "0.9rem",
													color: "#888",
													display: "flex",
													alignItems: "center",
													gap: "0.5rem",
												}}
											>
												<span style={{ fontSize: "1rem" }}>🔐</span>
												<span>256-bit encrypted • One-click payments</span>
											</div>
										</div>
									</div>
									{/* Modern Toggle Switch */}
									<div
										style={{
											width: "68px", // Wider toggle
											height: "36px", // Taller toggle
											borderRadius: "18px",
											background: shouldSaveCard
												? "linear-gradient(135deg, #c4a77d 0%, #a67c52 100%)"
												: "#252525",
											padding: "4px",
											transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
											boxShadow: shouldSaveCard
												? "0 2px 12px rgba(196, 167, 125, 0.4), inset 0 1px 2px rgba(255,255,255,0.2)"
												: "inset 0 2px 4px rgba(0, 0, 0, 0.4)",
											border: shouldSaveCard ? "none" : "1px solid #333",
											flexShrink: 0,
										}}
									>
										<div
											style={{
												width: "28px",
												height: "28px",
												borderRadius: "50%",
												background: shouldSaveCard
													? "linear-gradient(135deg, #fff 0%, #f0f0f0 100%)"
													: "linear-gradient(135deg, #555 0%, #444 100%)",
												boxShadow: shouldSaveCard
													? "0 2px 8px rgba(0, 0, 0, 0.3)"
													: "0 1px 3px rgba(0, 0, 0, 0.3)",
												transform: shouldSaveCard ? "translateX(32px)" : "translateX(0)",
												transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
											}}
										/>
									</div>
								</div>
							</div>
						)}
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
						<path fill="#2d3441" d="M8.7.49l18 18H9.34L0 9.16Z" />
						<text style={{ fontSize: "1.15rem", fontWeight: 800 }} x="48" y="16" textAnchor="start">
							Alpine.js
						</text>
					</svg>
				</div>
			</div>
		</div>
	);
}
