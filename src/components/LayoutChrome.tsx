"use client";

import { useEffect, useState, type PropsWithChildren } from "react";
import { usePathname } from "next/navigation";
import Navbar from "@/components/Navbar";
import ScrollToTopButton from "@/components/ScrollToTopButton";

export default function LayoutChrome({ children }: PropsWithChildren) {
	const pathname = usePathname();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const hideNavbar =
		typeof pathname === "string" && (pathname.startsWith("/manage-subscription") || pathname.startsWith("/admin"));

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
			</footer>
			{mounted && (
				<div id="scroll-to-top-portal">
					<ScrollToTopButton />
				</div>
			)}
		</div>
	);
}
