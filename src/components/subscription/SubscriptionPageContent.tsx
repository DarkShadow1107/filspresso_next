"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { buildPageHref } from "@/lib/pages";
import { writeSubscriptionIntent } from "@/lib/subscriptionCheckout";
import { isSignedIn, subscribeAuthState } from "@/lib/authState";

const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";

import {
	ClockIcon,
	
	
	HistoryCircleIcon,
	RosetteDiscountIcon,
	ArrowNarrowUpIcon,
	ArrowNarrowDownIcon,
	SparklesIcon,
	
	CpuIcon,
	ChartBarIcon,
	SimpleCheckedIcon,
	CoffeeIcon,
	BrandGeminiIcon,
	BrandOllamaIcon,
	BrandGrokIcon,
	BrandLiquidIcon,
	PenIcon,
} from "@/icons";

import { ALL_TEXT_MODEL_KEYS, normalizeModelTier } from "@/lib/modelAccess";
import { featureLinesForTier, modelAccessLinesForTier, SPECTRE_SUBSCRIPTION, tierCanUsePlayground } from "@/lib/entitlements";

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
		kafelotModel: "tanka" as const,
		color: "red",
		recommended: false,
		tier: 5,
		benefits: [
			"200 capsules par mois",
			"Espressor Gran Lattissima Noir Élégant",
			"1x Suport capsules Mia Lume",
			"🤖 Kafelot - 1000 prompts/month",
			"🧠 MiniLM V2 access",
			"💾 200-conversation memory",
		],
	},
	{
		id: "max",
		title: "Max",
		priceRon: 279.99,
		priceRonYearly: 2699.99,
		kafelotModel: "tanka" as const,
		color: "purple",
		recommended: true,
		tier: 4,
		benefits: [
			"120 capsules par mois",
			"Espressor Vertuo Next C Rouge Cerise",
			"1x Suport des bonbons",
			"🤖 Kafelot - 300 prompts/month",
			"🧠 MiniLM V2 access",
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
			"🤖 Kafelot - 150 prompts/month",
			"🧠 MiniLM V2 access",
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
			"🤖 Kafelot - 100 prompts/month",
			"🧠 MiniLM V2 access",
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
			"🤖 Kafelot - 50 prompts/month",
			"🧠 MiniLM V2 access",
			"💾 5-conversation memory",
		],
	},
	{
		id: "free",
		title: "Free",
		priceRon: 0,
		priceRonYearly: 0,
		kafelotModel: "tanka" as const,
		color: "grey",
		recommended: false,
		tier: 0,
		benefits: [
			"🤖 Kafelot - 5 prompts/month (anonymous)",
			"🤖 Kafelot - 15 prompts/month (with account)",
			"🧠 MiniLM V2 access",
			"Default for all accounts",
		],
	},
] as const;

/** Per-plan monthly AI allowance, in RON, as served by /api/billing/allowances. */
type AllowanceTable = {
	anonymousRon: number;
	byTier: Record<string, number>;
};

/**
 * Compose the benefit list a plan card renders.
 *
 * Hardware, capsules and memory stay hand-written because they are commercial terms.
 * Model access is **derived** from the entitlement matrix, and the AI allowance is
 * **fetched** from the same table the backend charges against.
 *
 * The allowance used to be written out by hand here, and the copy went stale badly enough
 * to keep advertising a prompt quota that had been deleted from the product months
 * earlier. A number that is duplicated is a number that will be wrong.
 */
function benefitsForPlan(
	planId: string,
	baseBenefits: readonly string[],
	allowances: AllowanceTable | null,
): string[] {
	const tier = normalizeModelTier(planId);
	const ron = allowances?.byTier?.[tier] ?? 0;
	// An allowance line is only stated when the number is actually known. Better a card
	// missing one line than a card quoting a figure the backend would not honour.
	const allowanceLine = allowances
		? `🤖 Kafelot AI — ${formatRon(ron)} included each month`
		: null;
	const derived = [...modelAccessLinesForTier(tier), ...featureLinesForTier(tier)];

	// Build the base list with the allowance line in place of any stale prompt line.
	const cleaned = baseBenefits.filter((b) => !/prompts?\s*\/\s*month/i.test(b));
	const base = allowanceLine ? [allowanceLine, ...cleaned] : cleaned;

	const insertAt = base.findIndex((b) => b.includes("MiniLM"));
	if (insertAt === -1) return [...base, ...derived];
	return [...base.slice(0, insertAt + 1), ...derived, ...base.slice(insertAt + 1)];
}

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

export default function SubscriptionPageContent() {
	const { addItem } = useCart({ passive: true });
	const cardsInnerRef = useRef<HTMLDivElement | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const router = useRouter();
	const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
	const [currentSubscription, setCurrentSubscription] = useState<CurrentSubscription | null>(null);
	const [scheduledSubscription, setScheduledSubscription] = useState<ScheduledSubscription | null>(null);
	const [showConfirmModal, setShowConfirmModal] = useState(false);
	const [pendingPlan, setPendingPlan] = useState<(typeof plans)[number] | null>(null);
	const [hoveredManageBtn, setHoveredManageBtn] = useState(false);
	const [allowances, setAllowances] = useState<AllowanceTable | null>(null);

	// The Spectre subscription's terms, fetched from the service that charges for them.
	// The copy in SPECTRE_SUBSCRIPTION covers first paint; this is the authority.
	const [spectreAddon, setSpectreAddon] = useState<{ monthlyRon: number; yearlyRon: number }>({
		monthlyRon: SPECTRE_SUBSCRIPTION.monthlyRon,
		yearlyRon: SPECTRE_SUBSCRIPTION.annualRon,
	});
	const [spectreBusy, setSpectreBusy] = useState(false);
	// Max and Ultimate bundle it, so offering them a paid add-on would be selling them
	// something they already have.
	const tierGrantsSpectre = tierCanUsePlayground(currentSubscription?.tier ?? null);

	// HSL(180, 52%, 48%). Declared here as well as in CSS because the benefit icons take a
	// hex colour prop and cannot read the custom property.
	const SPECTRE_ACCENT = "#3ababa";

	// The API price list the card shows.
	//
	// Only the text models, because those are the only ones the Playground offers: listing a
	// vision or audio price on a card that cannot unlock it would be quoting for something
	// the customer cannot buy.
	//
	// Left empty on failure, and the card says so. A placeholder row reading zero would be
	// worse than no table: it reads as a price someone set.
	const [spectrePrices, setSpectrePrices] = useState<
		Array<{ modelKey: string; label: string; inputPer1M: number; outputPer1M: number }>
	>([]);

	// The add-on's bullets, phrased so the card reads the same whether or not the
	// account's plan already includes the Playground.
	const spectreBenefits = [
		{ text: "Full access to the Spectre Playground", note: false },
		{ text: "Every model unlocked, including the LFM 2.5 8B", note: false },
		{
			text: "Model usage is billed separately at the API prices listed here, and is not included in this subscription",
			note: true,
		},
		tierGrantsSpectre
			? { text: "Already included with your plan", note: false }
			: { text: "Works alongside any plan", note: false },
	];

	useEffect(() => {
		let cancelled = false;
		fetch(`${API_BASE}/api/billing/pricing?audience=api`, { credentials: "same-origin" as const })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: { models?: Array<{ modelKey: string; label: string; inputPer1M: number; outputPer1M: number }> } | null) => {
				if (cancelled || !body?.models) return;
				const order = ALL_TEXT_MODEL_KEYS as readonly string[];
				const byKey = new Map(body.models.map((m) => [m.modelKey, m]));
				setSpectrePrices(
					order
						.map((key) => byKey.get(key))
						.filter((m): m is NonNullable<typeof m> => Boolean(m)),
				);
			})
			.catch(() => {
				// Silent: the card degrades to an explanation instead of a table.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		fetch(`${API_BASE}/api/spectre/subscription`, { credentials: "same-origin" as const })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: { monthlyRon?: number; annualRon?: number } | null) => {
				if (cancelled || !body) return;
				setSpectreAddon({
					monthlyRon: Number(body.monthlyRon ?? SPECTRE_SUBSCRIPTION.monthlyRon),
					yearlyRon: Number(body.annualRon ?? SPECTRE_SUBSCRIPTION.annualRon),
				});
			})
			.catch(() => {
				// The static copy stands, so the card always shows a price.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const subscribeToSpectre = async () => {
		setSpectreBusy(true);
		notify("Subscribing to the Spectre Playground…", 4000, "info", "spectre");
		try {
			const res = await fetch(`${API_BASE}/api/spectre/subscribe`, {
				method: "POST",
				credentials: "same-origin" as const,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ billingCycle: billingPeriod === "yearly" ? "annual" : "monthly" }),
			});
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			if (!res.ok) {
				// The backend's own refusal is the useful thing to show: "add a default card"
				// tells the customer what to do, and a generic failure does not.
				notify(body?.message || "We could not complete the subscription.", 6000, "error", "spectre");
				return;
			}
			notify("The Spectre Playground is now active on your account.", 5000, "success", "spectre");
			router.push(buildPageHref("playground"));
		} catch {
			notify("We could not reach the billing service. Nothing was charged.", 6000, "error", "spectre");
		} finally {
			setSpectreBusy(false);
		}
	};

	// The per-plan AI allowance, fetched from the same table the backend charges against.
	// Null until it arrives, and null for good if it fails: the plan cards then simply omit
	// the allowance line rather than quoting a number this page made up.
	useEffect(() => {
		let cancelled = false;
		fetch(`${API_BASE}/api/billing/allowances`, {
			credentials: "same-origin" as const,
			headers: { accept: "application/json" },
		})
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
			.then((body: { anonymousRon: number; tiers?: Array<{ tier: string; allowanceRon: number }> }) => {
				if (cancelled) return;
				const byTier: Record<string, number> = {};
				for (const row of body.tiers ?? []) byTier[row.tier] = row.allowanceRon;
				setAllowances({ anonymousRon: Number(body.anonymousRon ?? 0), byTier });
			})
			.catch(() => {
				// Deliberately silent. This is a pricing page that must render even when the
				// billing service is unreachable; the cards degrade to omitting one line.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const { notify } = useNotifications();

	// Sign-in state is server-resolved, so subscribe to the cached auth state
	// rather than reading a credential out of storage.
	const isLoggedIn = useSyncExternalStore(subscribeAuthState, isSignedIn, () => false);

	useEffect(() => {
		if (typeof window === "undefined") return;

		// The httpOnly session cookie rides along on every request, so ask the
		// server unconditionally instead of gating on the cached client flag.
		{
			try {
				fetch(`${API_BASE}/api/subscriptions`, {
					credentials: "same-origin" as const,
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
		if (action === "current") return "Current Plan";
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
		if (action === "current") return "Current Plan";
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

	// The add-on's badge uses the ladder's own maths, so it says the same thing the other
	// cards say for the same yearly switch. It reads 8%, against 40% on the plans: the
	// add-on is priced close to twelve months rather than discounted like a tier, so
	// borrowing the ladder's headline number would be a lie told by a shared constant.
	const spectreSavings = calculateSavings(spectreAddon.monthlyRon, spectreAddon.yearlyRon);

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

		const signedIn = isSignedIn();
		if (!signedIn) {
			notify("Please log in to change your plan", 5000, "error", "subscription");
			return;
		}

		try {
			const billingCycle = billingPeriod === "yearly" ? "annual" : "monthly";

			const res = await fetch(`${API_BASE}/api/subscriptions/change`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
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
							: null,
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

	const handleAdd = useCallback(
		(planId: string, planTitle: string, monthlyPrice: number, yearlyPrice: number) => {
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

			// A subscription is recorded as an intent, not as a line in the coffee cart.
			//
			// It used to be added to the cart, and the cart rejected it -- a coffee capsule
			// named "sub-ultimate" does not exist -- while the customer was still sent to
			// payment with an empty cart, where the only thing left to charge was the 24.99 RON
			// delivery fee. A subscription has no stock, no delivery and no destination; it is
			// checked out on its own terms.
			writeSubscriptionIntent({
				tier: planId,
				cycle: billingPeriod === "yearly" ? "annual" : "monthly",
				title: planTitle,
				priceRon: price,
			});
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
		},
		[billingPeriod, isLoggedIn, addItem, notify, router],
	);

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
									margin: "0.4rem 0 0 0",
									color: currentSubscription.status === "ending" ? "#ef4444" : "#c4a77d",
									fontSize: "1.25rem",
									fontWeight: 600,
									display: "flex",
									alignItems: "center",
									gap: "8px",
								}}
							>
								{currentSubscription.tier.charAt(0).toUpperCase() + currentSubscription.tier.slice(1)}
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: "4px",
										fontSize: "0.95rem",
										opacity: 0.8,
										background: "rgba(196, 167, 125, 0.1)",
										padding: "2px 8px",
										borderRadius: "4px",
										marginLeft: "4px",
									}}
								>
									{currentSubscription.billing_cycle === "annual" ? (
										<span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
											<HistoryCircleIcon size={20} color="#ae8966" /> Yearly
										</span>
									) : (
										<span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
											<ClockIcon size={20} color="#ae8966" /> Monthly
										</span>
									)}
								</span>
							</p>
						</div>
						<div style={{ textAlign: "right" }}>
							<p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
								{currentSubscription.status === "ending" ? (
									<>
										<span style={{ color: "#ef4444" }}>Ends</span>{" "}
										{new Date(
											currentSubscription.end_date || currentSubscription.renewal_date || "",
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
							<p
								style={{
									margin: 0,
									color: "#888",
									fontSize: "0.85rem",
									display: "flex",
									alignItems: "center",
									gap: "8px",
								}}
							>
								<ClockIcon size={20} /> Scheduled Plan
							</p>
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

				<div className="billing-toggle-container">
					<div className="billing-toggle" style={{ padding: "0.6rem", gap: "0.8rem" }}>
						<button
							className={`toggle-btn ${billingPeriod === "monthly" ? "active" : ""}`}
							onClick={() => setBillingPeriod("monthly")}
							style={{ minWidth: "160px" }}
						>
							<ClockIcon size={26} color="white" />
							<span>Monthly</span>
						</button>
						<button
							className={`toggle-btn ${billingPeriod === "yearly" ? "active" : ""}`}
							onClick={() => setBillingPeriod("yearly")}
							style={{ minWidth: "160px" }}
						>
							<HistoryCircleIcon size={26} color="white" />
							<span>Yearly</span>
						</button>
					</div>
					<div
						className="savings-notice"
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: "0.5rem",
							marginTop: "1.5rem",
							opacity: billingPeriod === "yearly" ? 1 : 0,
							transition: "opacity 0.3s ease",
						}}
					>
						<RosetteDiscountIcon size={22} color="white" />
						<span>Save up to 40% with yearly billing!</span>
					</div>
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
									<p className="card_price">{plan.priceRon === 0 ? "Free" : formatRon(currentPrice)}</p>
									{billingPeriod === "yearly" && plan.priceRon > 0 && (
										<p className="card_price-breakdown">{formatRon(currentPrice / 12)}/month</p>
									)}
									<ul className="card_bullets" style={{ padding: 0, listStyle: "none" }}>
{(plan.id === "free"
										? benefitsForPlan(
												plan.id,
												[
													allowances
														? `Kafelot AI — ${allowances.anonymousRon.toFixed(2).replace(".", ",")} RON free for anonymous visitors`
														: "Kafelot AI — a small free allowance for anonymous visitors",
													"MiniLM V2 access",
													"Default for all accounts",
												],
												allowances,
											)
										: benefitsForPlan(
												plan.id,
												plan.benefits as readonly string[],
												allowances,
											)
										).map((benefit) => {
											const getIcon = () => {
												const iconSize = 20;
												const iconColor = "#ae8966";
if (benefit.toLowerCase().includes("lfm") || benefit.toLowerCase().includes("qwen"))
												return <BrandLiquidIcon size={iconSize} color={iconColor} />;
												if (benefit.toLowerCase().includes("minilm"))
													return <CpuIcon size={iconSize} color={iconColor} />;
												if (benefit.includes("🎼"))
													return <BrandGrokIcon size={iconSize} color={iconColor} />;
												if (benefit.includes("⚡"))
													return <BrandOllamaIcon size={iconSize} color={iconColor} />;
												if (benefit.includes("🤖"))
													return <BrandGeminiIcon size={iconSize} color={iconColor} />;
												if (benefit.includes("🧠"))
													return <BrandGeminiIcon size={iconSize} color={iconColor} />;
												if (benefit.includes("💾"))
													return <HistoryCircleIcon size={iconSize} color={iconColor} />;
												// Vision model access → Ollama icon
												if (benefit.includes("📷"))
													return <BrandOllamaIcon size={iconSize} color={iconColor} />;
												// Molecule Helper (LFM 2 VL) → Grok icon
												if (benefit.includes("🧬"))
													return <BrandGrokIcon size={iconSize} color={iconColor} />;
												if (benefit.includes("📊"))
													return <ChartBarIcon size={iconSize} color={iconColor} />;
												if (benefit.includes("✏️")) return <PenIcon size={iconSize} color={iconColor} />;
												if (
													benefit.toLowerCase().includes("kafelot") ||
													benefit.toLowerCase().includes("prompts")
												)
													return <BrandGeminiIcon size={iconSize} color={iconColor} />;
												if (benefit.toLowerCase().includes("suport"))
													return <SimpleCheckedIcon size={iconSize} color={iconColor} />;
												if (benefit.toLowerCase().includes("capsules"))
													return <CoffeeIcon size={iconSize} color={iconColor} />;
												if (benefit.toLowerCase().includes("espressor"))
													return <SparklesIcon size={iconSize} color={iconColor} />;
												return <SimpleCheckedIcon size={iconSize} color={iconColor} />;
											};
											const cleanBenefit = benefit.replace(/[🎼⚡🤖🧠💾📷🧬📊✏️]\s*/g, "");
											return (
												<li
													key={benefit}
													style={{
														display: "flex",
														alignItems: "center",
														gap: "12px",
														marginBottom: "12px",
													}}
												>
													<span
														style={{
															flexShrink: 0,
															width: "24px",
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
														}}
													>
														{getIcon()}
													</span>
													<span
														style={{
															fontSize: "0.95rem",
															color: "rgba(221, 221, 221, 0.9)",
															lineHeight: "1.4",
														}}
													>
														{cleanBenefit}
													</span>
												</li>
											);
										})}
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
					{/* The Spectre Playground subscription, rendered LAST and spanning two card
					    widths. It is a separate product rather than a rung on the ladder, so it reads
					    after the plans instead of inside them.

					    `cards_card` opts it into the same ghost-card hover as the six tiers, which
					    makes it a seventh item in both grids. Its ghost needs matching geometry and
					    a teal of its own -- see .overlay .card:nth-child(7) in spectre-addon.css.

					    No `card-${color}` class: the teal comes from that stylesheet, not from a
					    position in the ladder. */}
					<article className="cards_card card card-spectre" key="spectre-addon">
						{billingPeriod === "yearly" && spectreSavings > 0 && (
							<span className="card_savings-badge">Save {spectreSavings}%</span>
						)}
						<div className="card-spectre__terms">
							<span className="card_kicker">Add-on subscription</span>
							<h2 className="card_heading">Spectre Playground</h2>
							<p className="card_price">
								{billingPeriod === "yearly"
									? formatRon(spectreAddon.yearlyRon)
									: formatRon(spectreAddon.monthlyRon)}
							</p>
							{billingPeriod === "yearly" ? (
								<p className="card_price-breakdown">
									{formatRon(spectreAddon.yearlyRon / 12)}/month
								</p>
							) : null}
							<ul className="card-spectre__benefits">
								{spectreBenefits.map((benefit) => (
									<li key={benefit.text}>
										<span className="card-spectre__benefit-icon">
											<SimpleCheckedIcon size={16} color={SPECTRE_ACCENT} />
										</span>
										<span
											className={
												benefit.note ? "card-spectre__benefit-text card-spectre__benefit-text--note" : "card-spectre__benefit-text"
											}
										>
											{benefit.text}
										</span>
									</li>
								))}
							</ul>
							<div className="card-spectre__actions">
								{tierGrantsSpectre ? (
									<span className="card_current">
										Included with your {currentSubscription?.tier.toUpperCase()} plan
									</span>
								) : (
									<button
										type="button"
										className="card_cta cta"
										onClick={() => void subscribeToSpectre()}
										disabled={spectreBusy}
									>
										{spectreBusy ? "Subscribing…" : "Unlock the Playground"}
									</button>
								)}
							</div>
							{/*
								The fine print, below the card rather than inside it.

								"Available on any plan, including Free" is true, and it was easy to
								read as "available on every plan" -- which is what a Max or Ultimate
								customer already has, and what they would then be told to buy a
								second time. Hence the exception, stated plainly.
							*/}
							<p className="card-spectre__fineprint">
								Available on any plan, including Free. Max and Ultimate already include it.
							</p>
						</div>
<div className="card-spectre__prices">
						<h3 className="card-spectre__prices-title">What usage costs per 1M tokens (RON)</h3>
						{spectrePrices.length === 0 ? (
							<p className="card-spectre__prices-note">
								Prices load with the page. Nothing is charged until you send a message,
								and then it comes out of your funded wallet.
							</p>
						) : (
							<table className="card-spectre__prices-table">
								<thead>
									<tr>
										<th scope="col">Model</th>
										<th scope="col">Input</th>
										<th scope="col">Output</th>
									</tr>
								</thead>
									<tbody>
										{spectrePrices.map((row) => (
											<tr key={row.modelKey}>
												<td>{row.label}</td>
												<td>{row.inputPer1M.toFixed(2)}</td>
												<td>{row.outputPer1M.toFixed(2)}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					</article>

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
						<h3
							style={{
								fontSize: "1.5rem",
								fontWeight: 700,
								color: "#fff",
								marginBottom: "1rem",
								display: "flex",
								alignItems: "center",
								gap: "8px",
							}}
						>
							{getPlanAction(pendingPlan) === "upgrade" ? (
								<div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
									<ArrowNarrowUpIcon size={24} color="#ae8966" /> Upgrade
								</div>
							) : (
								<div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
									<ArrowNarrowDownIcon size={24} color="#ae8966" /> Downgrade
								</div>
							)}{" "}
							to {pendingPlan.title}?
						</h3>
						<div style={{ color: "#888", marginBottom: "1.5rem", lineHeight: 1.6 }}>
							<p style={{ marginBottom: "1rem" }}>
								You&apos;re changing from{" "}
								<strong style={{ color: "#c4a77d" }}>{currentSubscription?.tier}</strong> to{" "}
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
