"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import AccountPageContent from "@/components/account/AccountPageContent";
import AccountManagement from "@/components/account/AccountManagement";
import { fetchCurrentAccount } from "@/lib/clientAuth";

export default function AccountPage() {
	// The session lives in an httpOnly cookie, so sign-in state can only come
	// from the server. `null` means "not determined yet" and renders the login UI
	// until the probe resolves.
	const [resolved, setResolved] = useState<boolean | null>(null);

	useEffect(() => {
		let cancelled = false;
		void fetchCurrentAccount().then((account) => {
			if (!cancelled) setResolved(Boolean(account));
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const isLoggedIn = useSyncExternalStore(
		(subscribe) => {
			if (typeof window === "undefined") return () => undefined;
			const syncLoginState = () => subscribe();
			window.addEventListener("session-update", syncLoginState);
			window.addEventListener("storage", syncLoginState);
			return () => {
				window.removeEventListener("session-update", syncLoginState);
				window.removeEventListener("storage", syncLoginState);
			};
		},
		() => resolved === true,
		() => false,
	);

	if (isLoggedIn) {
		return <AccountManagement />;
	}

	return <AccountPageContent />;
}
