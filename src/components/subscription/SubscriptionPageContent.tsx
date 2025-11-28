"use client";

import { useEffect, useRef, useState } from "react";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { buildPageHref } from "@/lib/pages";

type CurrentSubscription = {
	tier: string;
	billing_cycle: "monthly" | "annual" | null;
	price_ron: number;
	renewal_date: string | null;
	end_date: string | null;
	is_active: boolean;
	status: "active" | "ending" | "scheduled" | "cancelled";
};

type ScheduledSubscription = {
	tier: string;
	billing_cycle: "monthly" | "annual";
	price_ron: number;
	start_date: string;
	renewal_date: string;
	status: "scheduled";
};

const plans = [
	{
		id: "ultimate",
		title: "Ultimate",
		priceRon: 599.99,
		priceRonYearly: 6299.99,
		kafelotModel: "ode" as const,
		color: "red",
		recommended: false,
		tier: 5,
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
		tier: 4,
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
		tier: 3,
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
		tier: 2,
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
		tier: 1,
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
	const [currentSubscription, setCurrentSubscription] = useState<CurrentSubscription | null>(null);
	const [scheduledSubscription, setScheduledSubscription] = useState<ScheduledSubscription | null>(null);
	const [showConfirmModal, setShowConfirmModal] = useState(false);
	const [pendingPlan, setPendingPlan] = useState<(typeof plans)[number] | null>(null);
	const [hoveredManageBtn, setHoveredManageBtn] = useState(false);

	const { notify } = useNotifications();

	useEffect(() => {
		if (typeof window === "undefined") return;
		// Check sessionStorage for login state
		const session = sessionStorage.getItem("account_session");
		setIsLoggedIn(!!session);

		// Fetch current subscription if logged in
		if (session) {
			try {
				const { token } = JSON.parse(session);
				fetch("http://localhost:4000/api/subscriptions", {
					headers: { Authorization: `Bearer ${token}` },
				})
					.then((res) => res.json())
					.then((data) => {
						if (data.subscription && data.subscription.tier !== "free") {
							setCurrentSubscription(data.subscription);
							// Set billing period to match current subscription
							if (data.subscription.billing_cycle === "annual") {
								setBillingPeriod("yearly");
							}
						}
						if (data.scheduled) {
							setScheduledSubscription(data.scheduled);
						}
					})
					.catch(() => {
						// ignore errors
					});
			} catch {
				// ignore
			}
		}
	}, []);

	// Get current plan tier level
	const getCurrentTierLevel = (): number => {
		if (!currentSubscription) return 0;
		const plan = plans.find((p) => p.id === currentSubscription.tier.toLowerCase());
		return plan?.tier ?? 0;
	};

	// Determine if plan is upgrade, downgrade, or current
	const getPlanAction = (plan: (typeof plans)[number]): "current" | "upgrade" | "downgrade" => {
		const currentLevel = getCurrentTierLevel();
		if (plan.tier === currentLevel) return "current";
		return plan.tier > currentLevel ? "upgrade" : "downgrade";
	};

	// Get CTA button text based on plan status (shown normally)
	const getButtonText = (plan: (typeof plans)[number]): string => {
		const action = getPlanAction(plan);
		if (action === "current") return "✓ Current Plan";
		// For users without subscription, show "Get Started" for basic and "Get {Plan}" for others
		if (!currentSubscription) {
			return plan.id === "basic" ? "Get Started" : `Get ${plan.title}`;
		}
		// For users with subscription, show Upgrade/Downgrade
		if (action === "upgrade") return `Upgrade to ${plan.title}`;
		return `Downgrade to ${plan.title}`;
	};

	// Get CTA hover text (shown in overlay on hover)
	const getHoverText = (plan: (typeof plans)[number]): string => {
		const action = getPlanAction(plan);
		if (action === "current") return "✓ Current Plan";
		if (!currentSubscription) {
			return plan.id === "basic" ? "Get Started" : `Get ${plan.title}`;
		}
		if (action === "upgrade") return `Upgrade to ${plan.title}`;
		return `Downgrade to ${plan.title}`;
	};

	// Calculate savings percentage for yearly vs monthly
	const calculateSavings = (monthlyPrice: number, yearlyPrice: number): number => {
		const totalMonthly = monthlyPrice * 12;
		const savings = ((totalMonthly - yearlyPrice) / totalMonthly) * 100;
		return Math.round(savings); // Round to nearest integer
	};

	// Handle plan selection with confirmation for changes
	const handlePlanClick = (plan: (typeof plans)[number]) => {
		const action = getPlanAction(plan);

		// If it's the current plan, do nothing
		if (action === "current") {
			notify("You're already on this plan!", 3000, "info", "subscription");
			return;
		}

		// For plan changes, show confirmation modal
		if (currentSubscription) {
			setPendingPlan(plan);
			setShowConfirmModal(true);
			return;
		}

		// For new subscriptions, proceed directly
		handleAdd(plan.id, plan.title, plan.priceRon, plan.priceRonYearly);
	};

	// Confirm plan change
	const confirmPlanChange = async () => {
		if (!pendingPlan) return;

		const session = sessionStorage.getItem("account_session");
		if (!session) {
			notify("Please log in to change your plan", 5000, "error", "subscription");
			return;
		}

		try {
			const { token } = JSON.parse(session);
			const billingCycle = billingPeriod === "yearly" ? "annual" : "monthly";

			const res = await fetch("http://localhost:4000/api/subscriptions/change", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					tier: pendingPlan.id,
					billingCycle,
				}),
			});

			const data = await res.json();

			if (res.ok) {
				setShowConfirmModal(false);

				if (data.isUpgrade) {
					// Immediate upgrade
					notify(data.message, 5000, "success", "subscription");
					setCurrentSubscription(data.subscription);
					setScheduledSubscription(null);
				} else {
					// Scheduled downgrade
					notify(data.message, 6000, "success", "subscription");
					// Update current subscription to show it's ending
					setCurrentSubscription((prev) =>
						prev
							? {
									...prev,
									status: "ending",
									end_date: data.currentEnds,
									auto_renew: false,
							  }
							: null
					);
					setScheduledSubscription(data.scheduled);
				}

				setPendingPlan(null);
			} else {
				notify(data.error || "Failed to change plan", 5000, "error", "subscription");
			}
		} catch (error) {
			console.error("Plan change error:", error);
			notify("An error occurred while changing your plan", 5000, "error", "subscription");
		}
	};

	const handleAdd = (planId: string, planTitle: string, monthlyPrice: number, yearlyPrice: number, isPlanChange = false) => {
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

		// Small delay to ensure React has updated the DOM with new data-hover-text values
		const timeoutId = setTimeout(() => {
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
					// Use data-hover-text for overlay, fall back to button text
					overlayCta.textContent = cta.getAttribute("data-hover-text") ?? cta.textContent ?? "";
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
					const { inlineSize, blockSize } = boxSize ?? {
						inlineSize: target.offsetWidth,
						blockSize: target.offsetHeight,
					};
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

			// Store cleanup function
			(overlay as HTMLElement & { _cleanup?: () => void })._cleanup = () => {
				container.removeEventListener("pointermove", updateOverlayPosition);
				container.removeEventListener("pointerleave", resetOverlay);
				observer.disconnect();
			};
		}, 0);

		return () => {
			clearTimeout(timeoutId);
			const cleanup = (overlay as HTMLElement & { _cleanup?: () => void })._cleanup;
			if (cleanup) cleanup();
			overlay.innerHTML = "";
			overlay.style.removeProperty("--opacity");
			overlay.style.removeProperty("--x");
			overlay.style.removeProperty("--y");
		};
	}, [currentSubscription]);

	return (
		<section className="subscription-page">
			<div className="content">
				<h1 className="main_heading">{currentSubscription ? "Change Your Plan" : "Pricing"}</h1>

				{/* Current Plan Banner */}
				{currentSubscription && (
					<div
						className="current-plan-banner"
						style={{
							background:
								currentSubscription.status === "ending"
									? "linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(200, 50, 50, 0.1) 100%)"
									: "linear-gradient(135deg, rgba(196, 167, 125, 0.15) 0%, rgba(166, 124, 82, 0.15) 100%)",
							border: `1px solid ${
								currentSubscription.status === "ending" ? "rgba(239, 68, 68, 0.3)" : "rgba(196, 167, 125, 0.3)"
							}`,
							borderRadius: "12px",
							padding: "1rem 1.5rem",
							marginBottom: scheduledSubscription ? "1rem" : "2rem",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							flexWrap: "wrap",
							gap: "1rem",
						}}
					>
						<div>
							<p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
								{currentSubscription.status === "ending" ? "Current Plan (Ending)" : "Current Plan"}
							</p>
							<p
								style={{
									margin: "0.25rem 0 0 0",
									color: currentSubscription.status === "ending" ? "#ef4444" : "#c4a77d",
									fontSize: "1.25rem",
									fontWeight: 600,
								}}
							>
								{currentSubscription.tier.charAt(0).toUpperCase() + currentSubscription.tier.slice(1)} (
								{currentSubscription.billing_cycle === "annual" ? "Yearly" : "Monthly"})
							</p>
						</div>
						<div style={{ textAlign: "right" }}>
							<p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
								{currentSubscription.status === "ending" ? (
									<>
										<span style={{ color: "#ef4444" }}>Ends</span>{" "}
										{new Date(
											currentSubscription.end_date || currentSubscription.renewal_date || ""
										).toLocaleDateString()}
									</>
								) : (
									<>
										{currentSubscription.is_active ? "Active" : "Cancelled"} • Renews{" "}
										{new Date(currentSubscription.renewal_date || "").toLocaleDateString()}
									</>
								)}
							</p>
							<button
								onClick={() => router.push("/manage-subscription")}
								onMouseEnter={() => setHoveredManageBtn(true)}
								onMouseLeave={() => setHoveredManageBtn(false)}
								style={{
									background: hoveredManageBtn ? "rgba(196, 167, 125, 0.1)" : "transparent",
									border: "1px solid #c4a77d",
									color: "#c4a77d",
									padding: "6px 12px",
									borderRadius: "6px",
									fontSize: "0.85rem",
									cursor: "pointer",
									marginTop: "0.5rem",
									transition: "all 0.2s",
									transform: hoveredManageBtn ? "translateY(-1px)" : "none",
									boxShadow: hoveredManageBtn ? "0 2px 8px rgba(196, 167, 125, 0.3)" : "none",
								}}
							>
								← Manage Subscription
							</button>
						</div>
					</div>
				)}

				{/* Scheduled Subscription Banner */}
				{scheduledSubscription && (
					<div
						className="scheduled-plan-banner"
						style={{
							background: "linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(14, 150, 105, 0.1) 100%)",
							border: "1px solid rgba(16, 185, 129, 0.3)",
							borderRadius: "12px",
							padding: "1rem 1.5rem",
							marginBottom: "2rem",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							flexWrap: "wrap",
							gap: "1rem",
						}}
					>
						<div>
							<p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>📅 Scheduled Plan</p>
							<p style={{ margin: "0.25rem 0 0 0", color: "#10b981", fontSize: "1.25rem", fontWeight: 600 }}>
								{scheduledSubscription.tier.charAt(0).toUpperCase() + scheduledSubscription.tier.slice(1)} (
								{scheduledSubscription.billing_cycle === "annual" ? "Yearly" : "Monthly"})
							</p>
						</div>
						<div style={{ textAlign: "right" }}>
							<p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
								<span style={{ color: "#10b981" }}>Starts</span>{" "}
								{new Date(scheduledSubscription.start_date).toLocaleDateString()}
							</p>
							<p style={{ margin: "0.25rem 0 0 0", color: "#666", fontSize: "0.8rem" }}>
								{formatRon(scheduledSubscription.price_ron)}/
								{scheduledSubscription.billing_cycle === "annual" ? "year" : "month"}
							</p>
						</div>
					</div>
				)}

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
							const planAction = getPlanAction(plan);
							const isCurrentPlan = planAction === "current";
							return (
								<article
									key={plan.id}
									className={`cards_card card card-${plan.color}${isCurrentPlan ? " current-plan" : ""}`}
									style={
										isCurrentPlan
											? { border: "2px solid #c4a77d", boxShadow: "0 0 20px rgba(196, 167, 125, 0.3)" }
											: undefined
									}
								>
									{isCurrentPlan && (
										<span className="card_badge" style={{ background: "#c4a77d", color: "#000" }}>
											Current Plan
										</span>
									)}
									{!isCurrentPlan && plan.recommended && <span className="card_badge">Recommended</span>}
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
										className={`card_cta cta${isCurrentPlan ? " current" : ""}`}
										onClick={() => handlePlanClick(plan)}
										disabled={isCurrentPlan}
										data-hover-text={getHoverText(plan)}
										style={
											isCurrentPlan
												? {
														background: "rgba(196, 167, 125, 0.2)",
														cursor: "default",
														opacity: 0.8,
												  }
												: undefined
										}
									>
										{getButtonText(plan)}
									</button>
								</article>
							);
						})}
					</div>
					<div className="overlay cards_inner" ref={overlayRef} aria-hidden="true" />
				</div>
			</div>

			{/* Plan Change Confirmation Modal */}
			{showConfirmModal && pendingPlan && (
				<div
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						background: "rgba(0, 0, 0, 0.8)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 1000,
						padding: "1rem",
					}}
				>
					<div
						style={{
							background: "#1a1a1a",
							borderRadius: "16px",
							padding: "2rem",
							maxWidth: "500px",
							width: "100%",
							border: "1px solid #333",
						}}
					>
						<h3 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fff", marginBottom: "1rem" }}>
							{getPlanAction(pendingPlan) === "upgrade" ? "⬆️ Upgrade" : "⬇️ Downgrade"} to {pendingPlan.title}?
						</h3>
						<div style={{ color: "#888", marginBottom: "1.5rem", lineHeight: 1.6 }}>
							<p style={{ marginBottom: "1rem" }}>
								You're changing from <strong style={{ color: "#c4a77d" }}>{currentSubscription?.tier}</strong> to{" "}
								<strong style={{ color: getPlanAction(pendingPlan) === "upgrade" ? "#10b981" : "#f59e0b" }}>
									{pendingPlan.title}
								</strong>
								.
							</p>
							{getPlanAction(pendingPlan) === "upgrade" ? (
								<div
									style={{
										background: "rgba(16, 185, 129, 0.1)",
										border: "1px solid rgba(16, 185, 129, 0.3)",
										borderRadius: "8px",
										padding: "0.75rem 1rem",
										marginBottom: "0.75rem",
									}}
								>
									<p style={{ margin: 0, color: "#10b981" }}>
										✓ Your new plan will be <strong>activated immediately</strong>
									</p>
								</div>
							) : (
								<div
									style={{
										background: "rgba(245, 158, 11, 0.1)",
										border: "1px solid rgba(245, 158, 11, 0.3)",
										borderRadius: "8px",
										padding: "0.75rem 1rem",
										marginBottom: "0.75rem",
									}}
								>
									<p style={{ margin: 0, color: "#f59e0b" }}>
										⏳ Your current plan continues until{" "}
										<strong>{new Date(currentSubscription?.renewal_date || "").toLocaleDateString()}</strong>,
										then {pendingPlan.title} will activate.
									</p>
								</div>
							)}
							<p style={{ marginTop: "1rem", fontWeight: 600, color: "#fff" }}>
								New price:{" "}
								{formatRon(billingPeriod === "yearly" ? pendingPlan.priceRonYearly : pendingPlan.priceRon)}/
								{billingPeriod === "yearly" ? "year" : "month"}
							</p>
						</div>
						<div style={{ display: "flex", gap: "1rem" }}>
							<button
								onClick={() => {
									setShowConfirmModal(false);
									setPendingPlan(null);
								}}
								style={{
									flex: 1,
									background: "#333",
									color: "#fff",
									border: "none",
									padding: "12px 20px",
									borderRadius: "10px",
									fontSize: "0.95rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								Cancel
							</button>
							<button
								onClick={confirmPlanChange}
								style={{
									flex: 1,
									background:
										getPlanAction(pendingPlan) === "upgrade"
											? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
											: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
									color: "#fff",
									border: "none",
									padding: "12px 20px",
									borderRadius: "10px",
									fontSize: "0.95rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								{getPlanAction(pendingPlan) === "upgrade" ? "Confirm Upgrade" : "Schedule Downgrade"}
							</button>
						</div>
					</div>
				</div>
			)}
		</section>
	);
}
