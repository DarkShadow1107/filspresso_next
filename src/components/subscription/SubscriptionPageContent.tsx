"use client";

import { useEffect, useRef } from "react";
import useCart from "@/hooks/useCart";
import { useNotifications } from "@/components/NotificationsProvider";

const plans = [
	{
		id: "basic",
		title: "Basic",
		priceRon: 46.05,
		benefits: ["10 capsules par mois", "Espressor Essenza Mini Piano Noir C30"],
	},
	{
		id: "pro",
		title: "Pro",
		priceRon: 92.15,
		benefits: ["30 capsules par mois", "Espressor Vertuo Next C Rouge Cerise", "1x Suport des bonbons"],
	},
	{
		id: "ultimate",
		title: "Ultimate",
		priceRon: 138.25,
		benefits: ["60 capsules par mois", "Espressor Gran Lattissima Noir Élégant", "1x Suport capsules Mia Lume"],
	},
] as const;

function formatRon(value: number) {
	return `${value.toFixed(2).replace(".", ",")} RON`;
}

export default function SubscriptionPageContent() {
	const { addItem } = useCart();
	const cardsInnerRef = useRef<HTMLDivElement | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);

	const { notify } = useNotifications();

	const handleAdd = (planId: string, planTitle: string, price: number) => {
		addItem({ id: `sub-${planId}`, name: `${planTitle} Subscription - ${formatRon(price)}`, price });
		notify(`Added ${planTitle} to bag!`, 6000, "success", "subscription");
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
				<div className="cards">
					<div className="cards_inner" ref={cardsInnerRef}>
						{plans.map((plan) => (
							<article key={plan.id} className="cards_card card">
								<h2 className="card_heading">{plan.title}</h2>
								<p className="card_price">{formatRon(plan.priceRon)}</p>
								<ul className="card_bullets">
									{plan.benefits.map((benefit) => (
										<li key={benefit}>{benefit}</li>
									))}
								</ul>
								<button
									type="button"
									className="card_cta cta"
									onClick={() => handleAdd(plan.id, plan.title, plan.priceRon)}
								>
									{plan.id === "basic"
										? "Get Started"
										: plan.id === "pro"
										? "Upgrade to Pro"
										: "Upgrade to Ultimate"}
								</button>
							</article>
						))}
					</div>
					<div className="overlay cards_inner" ref={overlayRef} aria-hidden="true" />
				</div>
			</div>
		</section>
	);
}
