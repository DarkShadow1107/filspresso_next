"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { buildPageHref, type PageSlug, DEFAULT_PAGE_SLUG } from "@/lib/pages";
import { createDefaultAvatarDataUrl, readAccountSession } from "@/lib/accountSession";
import { UsersIcon, ShoppingCartIcon, HeartIcon } from "@/icons";

type NavLink = {
	slug: PageSlug;
	label: string;
};

type IconLink = NavLink & { icon: React.ElementType };

const links: NavLink[] = [
	{ slug: DEFAULT_PAGE_SLUG, label: "About" },
	{ slug: "love-coffee", label: "Coffee Types" },
	{ slug: "coffee", label: "Coffee" },
	{ slug: "machines", label: "Machines" },
	{ slug: "subscription", label: "Subscription" },
];

const iconLinks: IconLink[] = [
	{ slug: "account", label: "Account", icon: UsersIcon },
	{ slug: "favorites", label: "Favorites", icon: HeartIcon },
	{ slug: "shopping-bag", label: "Bag", icon: ShoppingCartIcon },
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

	// Account state: read from sessionStorage (set on signup/login)
	const [accountName, setAccountName] = useState<string | null>(null);
	const [accountIcon, setAccountIcon] = useState<string | null>(null);
	const lastFailedUrlRef = useRef<string | null>(null);
	const fallbackAvatarRef = useRef<string | null>(null);

	const getIconUrl = (icon: string | null) => {
		if (!icon) return null;
		let url = icon.trim();

		// Prevent double-prefixing if it already contains the target path
		if (url.startsWith("/images/icons/") || url.startsWith("images/icons/")) {
			if (!url.startsWith("/")) url = "/" + url;
		} else if (url.startsWith("/") || url.startsWith("http") || url.startsWith("data:")) {
			// Convert old /api/icons/ paths if they exist
			if (url.startsWith("/api/icons/")) {
				url = url.replace("/api/icons/", "/images/icons/");
			}
		} else {
			// Otherwise it's just a filename, construct the full relative path
			url = `/images/icons/${url}`;
		}

		// Normalize only internal icon paths and preserve explicit extensions.
		if (url.startsWith("/images/icons/") && !url.startsWith("data:")) {
			url = url.toLowerCase();
			if (!/\.(svg|png|jpe?g|ico|webp|avif)(\?.*)?$/i.test(url)) {
				url = `${url}.svg`;
			}
		}

		// Safety check: if it's a relative path with spaces, encode it
		if (url.startsWith("/") && !url.startsWith("data:")) {
			try {
				if (url.includes(" ") || url.includes("[") || url.includes("]")) {
					return encodeURI(url);
				}
			} catch {
				return url;
			}
		}
		return url;
	};

	useEffect(() => {
		if (typeof window === "undefined") return;
		const checkSession = () => {
			try {
				const session = readAccountSession();
				if (session) {
					const displayName = session.username || session.full_name || session.email || null;
					const iconUrl = getIconUrl(session.icon || null);
					const fallbackIcon = createDefaultAvatarDataUrl(displayName || "User");
					fallbackAvatarRef.current = fallbackIcon;
					setAccountName(displayName);
					if (iconUrl && iconUrl !== lastFailedUrlRef.current) {
						setAccountIcon(iconUrl);
					} else {
						setAccountIcon(fallbackIcon);
					}
				} else {
					setAccountName(null);
					setAccountIcon(null);
					lastFailedUrlRef.current = null;
					fallbackAvatarRef.current = null;
				}
			} catch (e) {
				console.error("Navbar session error:", e);
			}
		};
		checkSession();
		// Listen for storage events (cross-tab) and custom session-update event (same tab)
		const handleStorage = () => checkSession();
		window.addEventListener("storage", handleStorage);
		window.addEventListener("session-update", handleStorage);
		// Fallback polling for external session mutations that do not emit events.
		const interval = setInterval(checkSession, 30000);
		return () => {
			window.removeEventListener("storage", handleStorage);
			window.removeEventListener("session-update", handleStorage);
			clearInterval(interval);
		};
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
						style={{ pointerEvents: "auto", display: "inline-flex" }}
					>
						FILSPRESSO
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
							{iconLinks.map(({ slug, label, icon: IconComponent }) => (
								<li key={slug}>
									{slug === "account" ? (
										<Link
											href={buildPageHref(slug)}
											onClick={handleNavigate}
											style={{
												...navLinkStyle,
												display: "flex",
												alignItems: "center",
												justifyContent: "flex-start",
											}}
										>
											{accountIcon ? (
												<>
													<img
														src={accountIcon}
														alt="account"
														className="nav-account-icon"
														style={{
															marginRight: 10,
															display: "inline-block",
														}}
														onError={() => {
															if (accountIcon && !accountIcon.startsWith("data:image/")) {
																lastFailedUrlRef.current = accountIcon;
																setAccountIcon(fallbackAvatarRef.current || null);
															}
														}}
													/>
													<span style={{ display: "inline-block", verticalAlign: "middle" }}>
														{accountName || label}
													</span>
												</>
											) : (
												<>
													<div
														style={{
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															marginRight: isSmallScreen ? "0.5rem" : "12px",
														}}
													>
														<IconComponent size={32} className="nav-icon-animated" />
													</div>
													<span style={{ fontSize: "1.1rem", fontWeight: 500 }}>{label}</span>
												</>
											)}
										</Link>
									) : slug === "favorites" ? (
										<Link
											href={buildPageHref(slug)}
											onClick={handleNavigate}
											style={{
												...(navLinkStyle || {}),
												display: "flex",
												alignItems: "center",
												justifyContent: isSmallScreen ? "flex-start" : "center",
												gap: "8px",
												width: isSmallScreen ? "100%" : "auto",
											}}
										>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													height: 24,
													width: 24,
												}}
											>
												<IconComponent
													size={24}
													className="nav-icon-animated"
													style={{ width: "24px", height: "24px" }}
												/>
											</div>
											<span style={{ fontSize: "1.05rem", fontWeight: 500, lineHeight: 1 }}>{label}</span>
										</Link>
									) : (
										<Link
											href={buildPageHref(slug)}
											onClick={handleNavigate}
											style={{
												...(navLinkStyle || {}),
												display: "flex",
												alignItems: "center",
												justifyContent: isSmallScreen ? "flex-start" : "center",
												gap: "8px",
												width: isSmallScreen ? "100%" : "auto",
											}}
										>
											<IconComponent size={24} className="nav-icon-animated" />
											<span style={{ fontSize: "1.05rem", fontWeight: 500 }}>{label}</span>
										</Link>
									)}
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
