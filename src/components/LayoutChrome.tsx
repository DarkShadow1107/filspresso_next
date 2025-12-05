"use client";

import type { PropsWithChildren } from "react";
import { usePathname } from "next/navigation";
import Navbar from "@/components/Navbar";
import ScrollToTopButton from "@/components/ScrollToTopButton";

export default function LayoutChrome({ children }: PropsWithChildren) {
	const pathname = usePathname();
	const hideNavbar =
		typeof pathname === "string" &&
		(pathname.startsWith("/payment") || pathname.startsWith("/manage-subscription") || pathname.startsWith("/admin"));

	return (
		<>
			{!hideNavbar ? <Navbar /> : null}
			{children}
			{/* Scroll to top button */}
			<div id="scroll-to-top-portal">
				<ScrollToTopButton />
			</div>
		</>
	);
}
