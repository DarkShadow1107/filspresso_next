"use client";

import { useEffect, useState } from "react";
import AccountPageContent from "@/components/account/AccountPageContent";
import AccountManagement from "@/components/account/AccountManagement";
import { readAccountSession } from "@/lib/accountSession";

export default function AccountPage() {
	const [isLoggedIn, setIsLoggedIn] = useState(false);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		if (typeof window !== "undefined") {
			const syncLoginState = () => {
				setIsLoggedIn(Boolean(readAccountSession()?.token));
			};
			syncLoginState();
			window.addEventListener("session-update", syncLoginState);
			window.addEventListener("storage", syncLoginState);
			setIsLoading(false);
			return () => {
				window.removeEventListener("session-update", syncLoginState);
				window.removeEventListener("storage", syncLoginState);
			};
		}
		setIsLoading(false);
	}, []);

	if (isLoading) {
		return <div style={{ padding: "4rem", textAlign: "center", color: "rgba(255, 255, 255, 0.7)" }}>Loading account...</div>;
	}

	if (isLoggedIn) {
		return <AccountManagement />;
	}

	return <AccountPageContent />;
}
