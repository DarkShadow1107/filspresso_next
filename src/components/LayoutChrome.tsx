"use client";

import { useEffect, useState, type PropsWithChildren } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import ScrollToTopButton from "@/components/ScrollToTopButton";

export default function LayoutChrome({ children }: PropsWithChildren) {
	const pathname = usePathname();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const hideNavbar =
		typeof pathname === "string" &&
		(pathname.startsWith("/manage-subscription") ||
			pathname.startsWith("/admin") ||
			pathname.startsWith("/kafelot-privacy") ||
			pathname.startsWith("/privacy-policy") ||
			pathname.startsWith("/terms-and-conditions") ||
			pathname.startsWith("/sales-refunds"));

	const isFavorites = pathname === "/favorites";

	return (
		<div
			className="layout-chrome"
			style={{
				display: "flex",
				flexDirection: "column",
				minHeight: "100vh",
				background: isFavorites ? "radial-gradient(circle at top right, #151515 0%, #000000 100%)" : "transparent",
			}}
		>
			{!hideNavbar && <Navbar />}
			<main style={{ flex: 1 }}>{children}</main>
			<footer className="main-footer">
				<span>Copyright © 2026 Filspresso. All rights reserved.</span>
				<div className="main-footer-links">
					<Link href="/services" target="_blank" rel="noopener noreferrer">
						Services
					</Link>
					<Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">
						Privacy Policy
					</Link>
					<Link href="/terms-and-conditions" target="_blank" rel="noopener noreferrer">
						Terms and Conditions
					</Link>
					<Link href="/sales-refunds" target="_blank" rel="noopener noreferrer">
						Sales &amp; Refunds
					</Link>
				</div>
			</footer>
			{mounted && (
				<div id="scroll-to-top-portal">
					<ScrollToTopButton />
				</div>
			)}
		</div>
	);
}
