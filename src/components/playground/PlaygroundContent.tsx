"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { isSignedIn, subscribeAuthState } from "@/lib/authState";
import { fetchCurrentAccount } from "@/lib/clientAuth";
import { buildPageHref } from "@/lib/pages";
import { normalizeModelTier, type UserSubscriptionTier } from "@/lib/modelAccess";
import { SPECTRE_SUBSCRIPTION } from "@/lib/entitlements";
import PlaygroundModelLineup, { type SpectreAccessState } from "./PlaygroundModelLineup";
import PlaygroundWorkspace from "./PlaygroundWorkspace";

const ron = (value: number) => `${value.toLocaleString("en-GB", { minimumFractionDigits: 2 })} RON`;

export default function PlaygroundContent() {
	const isLoggedIn = useSyncExternalStore(subscribeAuthState, isSignedIn, () => false);
	const [session, setSession] = useState<{
		resolved: boolean;
		tier: UserSubscriptionTier;
		access: SpectreAccessState;
	}>({ resolved: false, tier: "none", access: "none" });

	useEffect(() => {
		const controller = new AbortController();
		void Promise.all([
			fetchCurrentAccount(controller.signal),
			fetch("/api/spectre/access", { credentials: "include", cache: "no-store", signal: controller.signal })
				.then((res) => res.ok ? res.json() : null)
				.catch(() => null),
		]).then(([account, access]: [Awaited<ReturnType<typeof fetchCurrentAccount>>, { hasAccess?: boolean; source?: string } | null]) => {
			if (controller.signal.aborted) return;
			setSession({
				resolved: true,
				tier: normalizeModelTier(account?.subscription ?? "none"),
				access: account && access?.hasAccess ? (access.source === "addon" ? "addon" : "tier") : "none",
			});
		});
		return () => controller.abort();
	}, [isLoggedIn]);

	if (!session.resolved) return <div className="playground-page"><p className="playground-loading" role="status">Checking your plan…</p></div>;

	// Keep the original sign-in card separate from the signed-in chat workspace.
	if (!isLoggedIn) return (
		<div className="playground-page pg-landing">
			<section className="playgate-card">
				<h1>Spectre Playground</h1>
				<p>Sign in to use the Playground.</p>
				<Link className="playground-cta" href={buildPageHref("account")}>Go to account</Link>
				<PlaygroundModelLineup tier={null} access="none" textOnly disclosure={false} />
			</section>
		</div>
	);

	if (session.access === "none") return (
		<div className="playground-page pg-landing">
			<section className="playgate-card">
				<h1>Spectre Playground</h1>
				<p>The Spectre Playground is a <strong>{ron(SPECTRE_SUBSCRIPTION.monthlyRon)} per month</strong> subscription, or {ron(SPECTRE_SUBSCRIPTION.annualRon)} a year. It is also included with the <strong>MAX</strong> and <strong>ULTIMATE</strong> plans.</p>
				<p className="playgate-note">Model usage is billed separately at API prices. The standalone subscription includes access, not usage.</p>
				<div className="playgate-actions">
					<Link className="playground-cta" href={buildPageHref("subscription")}>Subscribe</Link>
					<Link className="playground-cta playground-cta--ghost" href={buildPageHref("subscription")}>View plans</Link>
				</div>
				<PlaygroundModelLineup tier={session.tier} access="none" textOnly disclosure={false} />
			</section>
		</div>
	);

	return <PlaygroundWorkspace tier={session.tier} access={session.access} />;
}
