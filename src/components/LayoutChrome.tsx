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
			<style jsx>{`
				.main-footer {
					padding: 40px 20px;
					text-align: center;
					border-top: 1px solid rgba(190, 172, 154, 0.1);
					margin-top: auto;
					background: #000000;
				}
				.main-footer span {
					font-size: 13px;
					letter-spacing: 0.05em;
					font-weight: 500;
					background-image: linear-gradient(to right, #8e5a3c, #ffdab9 45%, #ffffff 50%, #ffdab9 55%, #8e5a3c);
					-webkit-background-clip: text;
					-webkit-text-fill-color: transparent;
					opacity: 1;
				}
			`}</style>
			{mounted && (
				<div id="scroll-to-top-portal">
					<ScrollToTopButton />
				</div>
			)}
		</div>
	);
}
