"use client";

import { useEffect, useState } from "react";
import AccountPageContent from "@/components/account/AccountPageContent";
import AccountManagement from "@/components/account/AccountManagement";

export default function AccountPage() {
	const [isLoggedIn, setIsLoggedIn] = useState(false);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		if (typeof window !== "undefined") {
			const session = sessionStorage.getItem("account_session");
			setIsLoggedIn(!!session);
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
