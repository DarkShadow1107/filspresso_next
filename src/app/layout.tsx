import "./globals.css";
import "../styles/notifications.css";
import LayoutChrome from "@/components/LayoutChrome";
import NotificationsProvider from "@/components/NotificationsProvider";
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
				<link rel="stylesheet" href="https://www.w3schools.com/w3css/4/w3.css" />
				<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons" />
				<link
					rel="stylesheet"
					href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css"
				/>
				<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" />
				<link rel="stylesheet" href="https://unicons.iconscout.com/release/v2.1.9/css/unicons.css" />
				<link
					rel="stylesheet"
					href="https://db.onlinewebfonts.com/c/51a69624ea6dd3b2f3e808c39d367a95?family=Abadi+MT+Std+Extra+Light+It"
				/>
			</head>
			<body>
				<NotificationsProvider>
					<LayoutChrome>{children}</LayoutChrome>
				</NotificationsProvider>
			</body>
		</html>
	);
}
