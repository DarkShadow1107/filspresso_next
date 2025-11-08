"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { buildPageHref, type PageSlug, DEFAULT_PAGE_SLUG } from "@/lib/pages";

type NavLink = {
	slug: PageSlug;
	label: string;
};

type IconLink = NavLink & { iconClass: string };

const links: NavLink[] = [
	{ slug: DEFAULT_PAGE_SLUG, label: "About" },
	{ slug: "love-coffee", label: "Coffee Types" },
	{ slug: "coffee", label: "Coffee" },
	{ slug: "machines", label: "Machines" },
	{ slug: "subscription", label: "Subscription" },
];

const iconLinks: IconLink[] = [
	{ slug: "account", label: "Account", iconClass: "fa fa-user-circle" },
	{ slug: "shopping-bag", label: "Bag", iconClass: "fa fa-shopping-bag" },
];

const MOBILE_BREAKPOINT = 1104;

export default function Navbar() {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isSmallScreen, setIsSmallScreen] = useState(false);
	const scrollYRef = useRef(0);
	const lockAppliedRef = useRef(false);
	const originalBodyStylesRef = useRef<{ overflow: string; position: string; top: string; width: string }>({
		overflow: "",
		position: "",
		top: "",
		width: "",
	});
	const originalHtmlOverflowRef = useRef<string | null>(null);

	const toggleMenu = useCallback(() => {
		setIsMenuOpen((prev) => !prev);
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const handleResize = () => {
			const small = window.innerWidth <= MOBILE_BREAKPOINT;
			setIsSmallScreen(small);
			if (!small) {
				setIsMenuOpen(false);
			}
		};
		handleResize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	useEffect(() => {
		if (typeof document === "undefined" || typeof window === "undefined") return undefined;
		const body = document.body;
		const html = document.documentElement;
		if (isMenuOpen && isSmallScreen) {
			if (!lockAppliedRef.current) {
				scrollYRef.current = window.scrollY;
				originalBodyStylesRef.current = {
					overflow: body.style.overflow || "",
					position: body.style.position || "",
					top: body.style.top || "",
					width: body.style.width || "",
				};
				originalHtmlOverflowRef.current = html.style.overflow || "";
				lockAppliedRef.current = true;
			}
			html.style.overflow = "hidden";
			body.style.overflow = "hidden";
			body.style.position = "fixed";
			body.style.top = `-${scrollYRef.current}px`;
			body.style.width = "100%";
		} else if (lockAppliedRef.current) {
			html.style.overflow = originalHtmlOverflowRef.current ?? "";
			body.style.overflow = originalBodyStylesRef.current.overflow;
			body.style.position = originalBodyStylesRef.current.position;
			body.style.top = originalBodyStylesRef.current.top;
			body.style.width = originalBodyStylesRef.current.width;
			window.scrollTo(0, scrollYRef.current);
			lockAppliedRef.current = false;
		}
		return () => {
			if (lockAppliedRef.current) {
				html.style.overflow = originalHtmlOverflowRef.current ?? "";
				body.style.overflow = originalBodyStylesRef.current.overflow;
				body.style.position = originalBodyStylesRef.current.position;
				body.style.top = originalBodyStylesRef.current.top;
				body.style.width = originalBodyStylesRef.current.width;
				window.scrollTo(0, scrollYRef.current);
				lockAppliedRef.current = false;
			}
		};
	}, [isMenuOpen, isSmallScreen]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsMenuOpen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleNavigate = useCallback(() => {
		setIsMenuOpen(false);
	}, []);

	const navDynamicStyle: CSSProperties | undefined = isSmallScreen
		? {
				position: "fixed",
				top: "clamp(70px, 12vh, 110px)",
				left: 0,
				right: 0,
				width: "100%",
				zIndex: 1200,
				background: "rgba(12, 11, 11, 0.92)",
				padding: "clamp(1.25rem, 5vw, 2.25rem) clamp(1.5rem, 6vw, 2.75rem) clamp(2rem, 8vw, 3rem)",
				transform: isMenuOpen ? "translateY(0)" : "translateY(calc(-100% - 18px))",
				opacity: isMenuOpen ? 1 : 0,
				visibility: isMenuOpen ? "visible" : "hidden",
				pointerEvents: isMenuOpen ? "auto" : "none",
				transition: "transform 0.35s ease, opacity 0.35s ease, visibility 0.35s ease",
				boxShadow: "0 22px 48px rgba(6, 5, 4, 0.55)",
				borderBottom: "1px solid rgba(174, 137, 102, 0.35)",
				maxHeight: "calc(100vh - clamp(70px, 12vh, 110px))",
				overflowY: "auto",
		  }
		: undefined;

	const navListStyle: CSSProperties | undefined = isSmallScreen
		? {
				display: "flex",
				flexDirection: "column",
				alignItems: "stretch",
				gap: "clamp(0.75rem, 4vw, 1.5rem)",
				margin: 0,
				padding: 0,
		  }
		: undefined;

	const navLinkStyle: CSSProperties | undefined = isSmallScreen
		? {
				display: "flex",
				alignItems: "center",
				justifyContent: "flex-start",
				width: "100%",
				fontSize: "16px",
				padding: "0.65rem 1.35rem",
				transform: "none",
				color: "inherit",
				textDecoration: "none",
		  }
		: undefined;

	const iconStyle: CSSProperties | undefined = isSmallScreen ? { marginRight: "0.5rem" } : undefined;

	return (
		<header className="header_body">
			<div
				className={`glass_morph${isMenuOpen ? " is-open" : ""}`}
				style={{
					backdropFilter: "blur(12px)",
					WebkitBackdropFilter: "blur(12px)",
					overflow: isSmallScreen && isMenuOpen ? "visible" : "hidden",
				}}
			>
				<div className="left" style={{ pointerEvents: "none", flex: "0 0 auto" }}>
					<Link
						href={buildPageHref(DEFAULT_PAGE_SLUG)}
						onClick={handleNavigate}
						className="logo"
						style={{ pointerEvents: "auto", display: "block" }}
					>
						<img src="/images/Logo_filspresso_web.png" alt="Filspresso" />
					</Link>
				</div>
				<button
					type="button"
					className={`nav-toggle${isMenuOpen ? " active" : ""}`}
					aria-expanded={isMenuOpen}
					aria-controls="primary-navigation"
					aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
					onClick={toggleMenu}
				>
					<span />
					<span />
					<span />
					<span className="sr-only">Toggle navigation</span>
				</button>
				<div className="right">
					<nav
						id="primary-navigation"
						className={`${isMenuOpen ? "open" : ""}${isSmallScreen ? " mobile-nav" : ""}`.trim()}
						style={navDynamicStyle}
						aria-hidden={isSmallScreen ? !isMenuOpen : undefined}
					>
						<ul style={navListStyle}>
							{links.map(({ slug, label }) => (
								<li key={slug}>
									<Link href={buildPageHref(slug)} onClick={handleNavigate} style={navLinkStyle}>
										{label}
									</Link>
								</li>
							))}
							{iconLinks.map(({ slug, label, iconClass }) => (
								<li key={slug}>
									<Link href={buildPageHref(slug)} onClick={handleNavigate} style={navLinkStyle}>
										<i className={iconClass} aria-hidden="true" style={iconStyle} />
										{label}
									</Link>
								</li>
							))}
						</ul>
					</nav>
				</div>
				{isSmallScreen && isMenuOpen && (
					<button
						type="button"
						onClick={handleNavigate}
						aria-hidden={true}
						tabIndex={-1}
						style={{
							position: "fixed",
							inset: 0,
							background: "rgba(10, 9, 9, 0.45)",
							opacity: isMenuOpen ? 1 : 0,
							pointerEvents: isMenuOpen ? "auto" : "none",
							transition: "opacity 0.35s ease",
							border: "none",
							margin: 0,
							padding: 0,
							zIndex: 1100,
							cursor: "default",
						}}
					/>
				)}
			</div>
		</header>
	);
}
