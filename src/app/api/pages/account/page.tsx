"use client";

import { useSyncExternalStore } from "react";
import AccountPageContent from "@/components/account/AccountPageContent";
import AccountManagement from "@/components/account/AccountManagement";
import { readAccountSession } from "@/lib/accountSession";

export default function AccountPage() {
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
		() => Boolean(readAccountSession()?.token),
		() => false,
	);

	if (isLoggedIn) {
		return <AccountManagement />;
	}

	return <AccountPageContent />;
}
