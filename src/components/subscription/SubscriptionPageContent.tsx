"use client";

import { useEffect, useRef, useState } from "react";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { buildPageHref } from "@/lib/pages";

const plans = [
	{
		id: "ultimate",
		title: "Ultimate",
		priceRon: 599.99,
		priceRonYearly: 6299.99,
		kafelotModel: "ode" as const,
		color: "red",
		recommended: false,
		benefits: [
			"200 capsules par mois",
			"Espressor Gran Lattissima Noir Élégant",
			"1x Suport capsules Mia Lume",
			"🎼 Kafelot Ode - 50 prompts/month",
			"⚡ Kafelot Villanelle - 100 prompts/month",
			"🤖 Kafelot Tanka - 1000 prompts/month",
			"💾 200-conversation memory",
			"🧠 Expert-level deep analysis",
			"🧬 Chemistry Mode - 10,000+ molecules visualization (ChEMBL)",
			"🔬 2D/3D molecular visualization with RDKit & Py3Dmol",
			"📊 Advanced molecular property analysis",
		],
	},
	{
		id: "max",
		title: "Max",
		priceRon: 279.99,
		priceRonYearly: 2699.99,
		kafelotModel: "villanelle" as const,
		color: "purple",
		recommended: true,
		benefits: [
			"120 capsules par mois",
			"Espressor Vertuo Next C Rouge Cerise",
			"1x Suport des bonbons",
			"⚡ Kafelot Villanelle - 20 prompts/month",
			"🤖 Kafelot Tanka - 300 prompts/month",
			"💾 100-conversation memory",
		],
	},
	{
		id: "pro",
		title: "Pro",
		priceRon: 169.99,
		priceRonYearly: 1699.99,
		kafelotModel: "tanka" as const,
		color: "blue",
		recommended: false,
		benefits: [
			"60 capsules par mois",
			"Espressor Vertuo Next C Rouge Cerise",
			"1x Suport des bonbons",
			"🤖 Kafelot Tanka - 150 prompts/month",
			"💾 50-conversation memory",
		],
	},
	{
		id: "plus",
		title: "Plus",
		priceRon: 109.99,
		priceRonYearly: 1099.99,
		kafelotModel: "tanka" as const,
		color: "yellow",
		recommended: false,
		benefits: [
			"30 capsules par mois",
			"Espressor Essenza Mini Piano Noir C30",
			"🤖 Kafelot Tanka - 100 prompts/month",
			"💾 20-conversation memory",
		],
	},
	{
		id: "basic",
		title: "Basic",
		priceRon: 55.99,
		priceRonYearly: 399.99,
		kafelotModel: "tanka" as const,
		color: "green",
		recommended: false,
		benefits: [
			"10 capsules par mois",
			"Espressor Essenza Mini Piano Noir C30",
			"🤖 Kafelot Tanka - 50 prompts/month",
			"💾 5-conversation memory",
		],
	},
] as const;

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

export default function SubscriptionPageContent() {
	const { addItem } = useCart();
	const cardsInnerRef = useRef<HTMLDivElement | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const router = useRouter();
	const [isLoggedIn, setIsLoggedIn] = useState(false);
	const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");

	const { notify } = useNotifications();

	useEffect(() => {
		if (typeof window === "undefined") return;
		// Check both keys for backward compatibility
		const isLoggedInState =
			localStorage.getItem("user_logged_in") === "true" ||
			localStorage.getItem("account_log") === "true" ||
			localStorage.getItem("login_status") === "1";
		setIsLoggedIn(isLoggedInState);
	}, []);

	// Calculate savings percentage for yearly vs monthly
	const calculateSavings = (monthlyPrice: number, yearlyPrice: number): number => {
		const totalMonthly = monthlyPrice * 12;
		const savings = ((totalMonthly - yearlyPrice) / totalMonthly) * 100;
		return Math.round(savings); // Round to nearest integer
	};

	const handleAdd = (planId: string, planTitle: string, monthlyPrice: number, yearlyPrice: number) => {
		const price = billingPeriod === "yearly" ? yearlyPrice : monthlyPrice;
		const period = billingPeriod === "yearly" ? "yearly" : "monthly";

		if (!isLoggedIn) {
			notify("You need to be logged in to subscribe. Please log in to your account.", 8000, "error", "subscription", {
				actions: [
					{
						id: "go-account",
						label: "Go to Account",
						variant: "primary",
						onClick: () => router.push(buildPageHref("account")),
					},
					{
						id: "stay",
						label: "Stay",
						variant: "ghost",
					},
				],
				persist: true,
			});
			return;
		}

		// Add subscription to cart and go directly to payment
		addItem({ id: `sub-${planId}`, name: `${planTitle} Subscription (${period}) - ${formatRon(price)}`, price });
		notify(`${planTitle} subscription selected! Proceeding to payment...`, 3000, "success", "subscription");

		// Store the timestamp token and redirect to payment
		if (typeof window !== "undefined") {
			try {
				window.sessionStorage.setItem("allow_payment_ts", String(Date.now()));
			} catch {
				// ignore storage errors
			}
		}

		setTimeout(() => {
			router.push(buildPageHref("payment"));
		}, 500);
	};

	useEffect(() => {
		if (typeof window === "undefined") return;
		const cardsInner = cardsInnerRef.current;
		const overlay = overlayRef.current;
		if (!cardsInner || !overlay) return;

		const cards = Array.from(cardsInner.querySelectorAll<HTMLElement>(".cards_card"));
		if (!cards.length) return;

		overlay.innerHTML = "";
		const ObserverCtor = window.ResizeObserver;
		if (!ObserverCtor) {
			return;
		}

		const overlayCards = cards.map((card) => {
			const overlayCard = document.createElement("div");
			overlayCard.classList.add("cards_card", "card");

			const cta = card.querySelector<HTMLElement>(".card_cta");
			if (cta) {
				const overlayCta = document.createElement("div");
				overlayCta.classList.add("card_cta", "cta");
				overlayCta.textContent = cta.textContent ?? "";
				overlayCta.setAttribute("aria-hidden", "true");
				overlayCard.appendChild(overlayCta);
			}

			overlay.appendChild(overlayCard);
			return overlayCard;
		});

		const observer = new ObserverCtor((entries) => {
			entries.forEach((entry) => {
				const target = entry.target as HTMLElement;
				const index = cards.indexOf(target);
				if (index < 0) return;
				const overlayCard = overlayCards[index];
				if (!overlayCard) return;

				const boxSize = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
				const { inlineSize, blockSize } = boxSize ?? { inlineSize: target.offsetWidth, blockSize: target.offsetHeight };
				overlayCard.style.width = `${inlineSize}px`;
				overlayCard.style.height = `${blockSize}px`;
			});
		});

		cards.forEach((card) => observer.observe(card));

		const container = cardsInner.parentElement;
		if (!container) {
			overlay.innerHTML = "";
			overlayCards.length = 0;
			observer.disconnect();
			return;
		}

		const updateOverlayPosition = (event: PointerEvent) => {
			const rect = container.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			overlay.style.setProperty("--opacity", "1");
			overlay.style.setProperty("--x", `${x}px`);
			overlay.style.setProperty("--y", `${y}px`);
		};

		const resetOverlay = () => {
			overlay.style.setProperty("--opacity", "0");
		};

		container.addEventListener("pointermove", updateOverlayPosition);
		container.addEventListener("pointerleave", resetOverlay);

		return () => {
			container.removeEventListener("pointermove", updateOverlayPosition);
			container.removeEventListener("pointerleave", resetOverlay);
			overlay.innerHTML = "";
			overlay.style.removeProperty("--opacity");
			overlay.style.removeProperty("--x");
			overlay.style.removeProperty("--y");
			observer.disconnect();
		};
	}, []);

	return (
		<section className="subscription-page">
			<div className="content">
				<h1 className="main_heading">Pricing</h1>

				{/* Billing Period Toggle */}
				<div className="billing-toggle-container">
					<div className="billing-toggle">
						<button
							className={`toggle-btn ${billingPeriod === "monthly" ? "active" : ""}`}
							onClick={() => setBillingPeriod("monthly")}
						>
							📅 Monthly
						</button>
						<button
							className={`toggle-btn ${billingPeriod === "yearly" ? "active" : ""}`}
							onClick={() => setBillingPeriod("yearly")}
						>
							📆 Yearly
						</button>
					</div>
					{billingPeriod === "yearly" && <div className="savings-notice">💰 Save up to 40% with yearly billing!</div>}
				</div>

				<div className="cards">
					<div className="cards_inner" ref={cardsInnerRef}>
						{plans.map((plan) => {
							const currentPrice = billingPeriod === "yearly" ? plan.priceRonYearly : plan.priceRon;
							const savings = billingPeriod === "yearly" ? calculateSavings(plan.priceRon, plan.priceRonYearly) : 0;
							return (
								<article key={plan.id} className={`cards_card card card-${plan.color}`}>
									{plan.recommended && <span className="card_badge">Recommended</span>}
									{billingPeriod === "yearly" && savings > 0 && (
										<span className="card_savings-badge">Save {savings}%</span>
									)}
									<h2 className="card_heading">{plan.title}</h2>
									<p className="card_price">{formatRon(currentPrice)}</p>
									{billingPeriod === "yearly" && (
										<p className="card_price-breakdown">{formatRon(currentPrice / 12)}/month</p>
									)}
									<ul className="card_bullets">
										{plan.benefits.map((benefit) => (
											<li key={benefit}>{benefit}</li>
										))}
									</ul>
									<button
										type="button"
										className="card_cta cta"
										onClick={() => handleAdd(plan.id, plan.title, plan.priceRon, plan.priceRonYearly)}
									>
										{plan.id === "basic"
											? "Get Started"
											: plan.id === "plus"
											? "Upgrade to Plus"
											: plan.id === "pro"
											? "Upgrade to Pro"
											: plan.id === "max"
											? "Upgrade to Max"
											: "Upgrade to Ultimate"}
									</button>
								</article>
							);
						})}
					</div>
					<div className="overlay cards_inner" ref={overlayRef} aria-hidden="true" />
				</div>
			</div>
		</section>
	);
}
