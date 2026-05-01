import React, { Suspense } from "react";
import "./globals.css";
import "../styles/notifications.css";
import LayoutChrome from "@/components/LayoutChrome";
import NotificationsProvider from "@/components/NotificationsProvider";
import { FavoritesProvider } from "@/components/FavoritesProvider";
import type { PropsWithChildren } from "react";

export const metadata = {
	title: "Filspresso",
	description: "Migrated Filspresso site - Next.js + TypeScript + Tailwind",
};

export default function RootLayout({ children }: PropsWithChildren) {
	return (
		<html lang="en">
			<head>
				<link rel="icon" type="image/png" href="/images/Logo_filspresso.png" />
				<link
					rel="stylesheet"
					href="https://db.onlinewebfonts.com/c/51a69624ea6dd3b2f3e808c39d367a95?family=Abadi+MT+Std+Extra+Light+It"
				/>
			</head>
			<body>
				<Suspense fallback={null}>
					<NotificationsProvider>
						<FavoritesProvider>
							<LayoutChrome>{children}</LayoutChrome>
						</FavoritesProvider>
					</NotificationsProvider>
				</Suspense>
			</body>
		</html>
	);
}
