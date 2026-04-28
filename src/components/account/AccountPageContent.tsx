"use client";

import React, { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import Head from "next/head";
import Script from "next/script";
import AccountIconGenerator from "@/components/AccountIconGenerator";
import { createDefaultAvatarDataUrl, writeAccountSession } from "@/lib/accountSession";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { UserPlusIcon, UserCheckIcon, LockIcon, AtSignIcon, EyeIcon, EyeOffIcon, BrandGoogleIcon } from "@/icons";

const ALLOWED_EMAIL_SUFFIXES = ["@gmail.com", "@outlook.com", "@yahoo.com"];

function hasSingleAt(value: string) {
	return value.split("@").length === 2;
}

function containsSpecialCharsPassword(value: string) {
	return /[`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(value);
}

function containsSpecialCharsEmail(value: string) {
	return /[`!#$%^&*()+\-=\[\]{};':"\\|,<>\/?~]/.test(value);
}

function formatNamePlaceholder(name?: string | null) {
	if (!name) return "there";
	return name;
}

export default React.memo(function AccountPageContent() {
	const router = useRouter();
	const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
	const [isSignUp, setIsSignUp] = useState(false);
	const [loginEmail, setLoginEmail] = useState("");
	const [loginPassword, setLoginPassword] = useState("");
	const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
	const [signName, setSignName] = useState("");
	const [signUsername, setSignUsername] = useState("");
	const [signIconDataUrl, setSignIconDataUrl] = useState<string | null>(null);
	const [signEmail, setSignEmail] = useState("");
	const [signPassword, setSignPassword] = useState("");
	const [signPasswordVisible, setSignPasswordVisible] = useState(false);
	const [loginMfaRequired, setLoginMfaRequired] = useState(false);
	const [loginChallengeToken, setLoginChallengeToken] = useState("");
	const [loginMfaCode, setLoginMfaCode] = useState("");
	const [socialProviderLoading, setSocialProviderLoading] = useState<"google" | null>(null);

	const { notify } = useNotifications();

	const onGoogleSignIn = useCallback((googleUser: GoogleUser) => {
		const profile = googleUser.getBasicProfile();
		console.log(`ID: ${profile.getId()}`);
		console.log(`Name: ${profile.getName()}`);
		console.log(`Image URL: ${profile.getImageUrl()}`);
		console.log(`Email: ${profile.getEmail()}`);
	}, []);

	const signOutGoogleAppOnly = useCallback(async () => {
		if (typeof window === "undefined") return;
		const auth2 = window.gapi?.auth2?.getAuthInstance?.();
		if (!auth2) return;
		await auth2.signOut();
		console.log("User signed out.");
	}, []);

	const initializeGooglePlatform = useCallback(() => {
		if (typeof window === "undefined" || !googleClientId || !window.gapi?.load) {
			return;
		}

		window.gapi.load("auth2", () => {
			try {
				const initResult = window.gapi?.auth2?.init({ client_id: googleClientId, scope: "profile email" });
				if (initResult && typeof (initResult as Promise<unknown>).catch === "function") {
					(initResult as Promise<unknown>).catch((error) => console.error("Google auth initialization failed:", error));
				}
			} catch (error) {
				console.error("Google auth initialization failed:", error);
			}
		});
	}, [googleClientId]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const extendedWindow = window as Window & {
			onSignIn?: (googleUser: GoogleUser) => void;
			signOut?: () => Promise<void>;
		};
		extendedWindow.onSignIn = onGoogleSignIn;
		extendedWindow.signOut = signOutGoogleAppOnly;

		return () => {
			delete extendedWindow.onSignIn;
			delete extendedWindow.signOut;
		};
	}, [onGoogleSignIn, signOutGoogleAppOnly]);

	const persistAccountSession = useCallback(
		(
			account: {
				full_name?: string;
				username: string;
				email: string;
				icon?: string | null;
				role?: string;
			},
			token: string | null,
		) => {
			const fullName = account.full_name || account.username;
			const fallbackIcon = createDefaultAvatarDataUrl(account.username || fullName || account.email || "User");
			writeAccountSession({
				full_name: fullName,
				username: account.username,
				email: account.email,
				icon: account.icon || fallbackIcon,
				role: account.role,
				token,
			});
		},
		[],
	);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const currentUrl = new URL(window.location.href);
		const oauthPayload = currentUrl.searchParams.get("oauth");
		const oauthError = currentUrl.searchParams.get("oauth_error");
		if (!oauthPayload && !oauthError) {
			return;
		}

		if (oauthPayload) {
			try {
				const normalized = oauthPayload.replace(/-/g, "+").replace(/_/g, "/");
				const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
				const decoded = JSON.parse(atob(padded));
				if (decoded?.account && typeof decoded.account === "object") {
					persistAccountSession(decoded.account, decoded.token || null);
					notify(
						`Welcome ${formatNamePlaceholder(decoded.account.full_name || decoded.account.username)}!`,
						5500,
						"success",
						"account",
					);
				}
			} catch (error) {
				console.error("Failed to parse OAuth callback payload:", error);
				notify("Social login callback could not be verified.", 6000, "error", "account");
			}
		}

		if (oauthError) {
			notify("Social login failed. Please try again or use email and password.", 6000, "error", "account");
		}

		currentUrl.searchParams.delete("oauth");
		currentUrl.searchParams.delete("oauth_error");
		router.replace(`${currentUrl.pathname}${currentUrl.search}`);
	}, [notify, persistAccountSession, router]);

	const handleSignUp = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const nickname = signName.trim();
			const username = signUsername.trim();
			const email = signEmail.trim();
			const password = signPassword;

			if (containsSpecialCharsEmail(email)) {
				notify(
					"Your e-mail address must not contain special characters!\nBUT some special characters are allowed, like the following characters: @_.",
					6000,
					"error",
					"account",
				);
				return;
			}

			const hasAllowedDomain = ALLOWED_EMAIL_SUFFIXES.some((suffix) => email.endsWith(suffix));
			if (!hasAllowedDomain || !nickname || !username || !hasSingleAt(email)) {
				notify(
					"Invalid e-mail address or empty full name/username, please insert a valid e-mail address and a username!",
					6000,
					"error",
					"account",
				);
				return;
			}

			if (!password) {
				notify("Please insert a strong password!", 6000, "error", "account");
				return;
			}

			if (password.length < 10) {
				notify("Your password is too short, it must contain at least 10 characters!", 6000, "error", "account");
				return;
			}

			if (!containsSpecialCharsPassword(password)) {
				notify("Your password is weak, it must contain special characters as well!", 6000, "error", "account");
				return;
			}

			// First, save the icon to the Python server (which stores it in public/images/icons/)
			let savedIconPath: string | null = null;
			const isSvgIcon =
				typeof signIconDataUrl === "string" &&
				(signIconDataUrl.startsWith("data:image/svg+xml") || signIconDataUrl.trim().startsWith("<svg"));
			if (signIconDataUrl && typeof window !== "undefined") {
				if (isSvgIcon) {
					try {
						const AI_BASE = process.env.NEXT_PUBLIC_AI_URL || "http://localhost:5000";
						const iconRes = await fetch(`${AI_BASE}/api/icons/save`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ username, svg: signIconDataUrl }),
						});
						const iconData = await iconRes.json();
						if (iconData.status === "success") {
							savedIconPath = iconData.icon_path;
							console.log("Icon saved successfully to:", savedIconPath);
						}
					} catch (e) {
						console.error("Failed to save icon:", e);
					}
				}
			}

			// Try to persist account to backend
			const payload = {
				full_name: nickname,
				username,
				email,
				password,
				icon: savedIconPath || signIconDataUrl || createDefaultAvatarDataUrl(username || nickname || email),
				enable2fa: false,
				includeQrCode: false,
			};

			if (typeof window !== "undefined") {
				try {
					const API_BASE =
						typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
					const response = await fetch(`${API_BASE}/api/auth/register`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload),
					});
					const data = await response.json();

					if (data?.status === "success") {
						const account = data.account || {
							full_name: nickname,
							username,
							email,
							icon: savedIconPath || data.icon_path || null,
						};
						const iconUrl = savedIconPath || data.icon_path || null;
						const token = data.token || null;
						persistAccountSession({ ...account, icon: account.icon || iconUrl }, token);

						notify(
							`Welcome ${nickname}, your account was registered with the following address ${email}`,
							6000,
							"success",
							"account",
						);

						// Cleanup and redirect only on success
						setIsSignUp(false);
						setLoginEmail(username);
						setLoginPassword("");
						setSignPassword("");
						setSignName("");
						setTimeout(() => router.push("/"), 1500);
					} else {
						notify(data?.message || "Failed to create account", 6000, "error", "account");
					}
				} catch (error) {
					console.error("Signup error:", error);
					notify("Failed to create account. Please check your connection.", 6000, "error", "account");
				}
			}
		},
		[router, notify, persistAccountSession, signEmail, signName, signPassword, signUsername, signIconDataUrl],
	);

	const attemptLogin = useCallback(async () => {
		if (typeof window === "undefined") return;
		const username = loginEmail.trim();
		const password = loginPassword;

		if (!username || !password) {
			notify("Username and password are required!", 6000, "error", "account");
			return;
		}

		// Use backend login endpoint
		try {
			const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
			const response = await fetch(`${API_BASE}/api/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password }),
			});
			const data = await response.json();

			if (response.status === 202 && data?.status === "mfa_required" && data?.challengeToken) {
				setLoginMfaRequired(true);
				setLoginChallengeToken(String(data.challengeToken));
				setLoginMfaCode("");
				setLoginPassword("");
				notify("Enter the code from your authenticator app.", 6000, "info", "account");
				return;
			}

			if (data?.status === "success" && data?.account) {
				const account = data.account;
				const token = data.token || null;
				persistAccountSession(account, token);
				notify(`Welcome back ${account.full_name || account.username}!`, 6000, "success", "account");
				setLoginPassword("");
				setLoginEmail("");
				setLoginMfaRequired(false);
				setLoginChallengeToken("");
				router.push("/");
			} else {
				notify(data?.message || "Invalid username or password!", 6000, "error", "account");
			}
		} catch (error) {
			console.error("Login error:", error);
			notify("Login failed. Please check your connection.", 6000, "error", "account");
		}
	}, [loginEmail, loginPassword, notify, persistAccountSession, router]);

	const verifyLoginMfa = useCallback(async () => {
		if (typeof window === "undefined") return;
		if (!loginChallengeToken || !loginMfaCode.trim()) {
			notify("Challenge token and code are required.", 5000, "error", "account");
			return;
		}

		try {
			const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
			const response = await fetch(`${API_BASE}/api/auth/login/mfa-verify`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ challengeToken: loginChallengeToken, code: loginMfaCode }),
			});
			const data = await response.json();

			if (data?.status === "success" && data?.account) {
				persistAccountSession(data.account, data.token || null);
				notify(`Welcome back ${data.account.full_name || data.account.username}!`, 6000, "success", "account");
				setLoginMfaRequired(false);
				setLoginChallengeToken("");
				setLoginMfaCode("");
				setLoginEmail("");
				router.push("/");
				return;
			}

			notify(data?.message || data?.error || "MFA verification failed.", 6000, "error", "account");
		} catch (error) {
			console.error("Login MFA verify error:", error);
			notify("MFA verification failed. Please try again.", 6000, "error", "account");
		}
	}, [loginChallengeToken, loginMfaCode, notify, persistAccountSession, router]);

	const handleLogin = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			attemptLogin();
		},
		[attemptLogin],
	);

	const handleForgot = useCallback(
		(event: MouseEvent<HTMLAnchorElement>) => {
			event.preventDefault();
			notify(
				"Password reset is not yet implemented. Please create a new account or contact support.",
				6000,
				"info",
				"account",
			);
		},
		[notify],
	);

	const handleSocialAuth = useCallback(
		(provider: "google") => {
			if (typeof window === "undefined") return;
			setSocialProviderLoading(provider);
			const API_BASE = typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "";
			const mode = isSignUp ? "signup" : "login";
			const returnTo = encodeURIComponent("/?page=account");
			window.location.assign(`${API_BASE}/api/auth/oauth/${provider}/start?mode=${mode}&returnTo=${returnTo}`);
		},
		[isSignUp],
	);

	return (
		<main className="account-page">
			<Head>{googleClientId ? <meta name="google-signin-client_id" content={googleClientId} /> : null}</Head>
			<Script
				src="https://apis.google.com/js/platform.js"
				strategy="afterInteractive"
				async
				defer
				onLoad={initializeGooglePlatform}
			/>
			<div className="section">
				<div className="container">
					<div className="row full-height justify-content-center">
						<div className="col-12 text-center align-self-center py-5">
							<div className="section pb-5 pt-5 pt-sm-2 text-center margin">
								<h6 className="mb-0 pb-3 font">
									<span>Log In </span>
									<span>Sign Up</span>
								</h6>
								<input
									className="checkbox"
									type="checkbox"
									id="reg-log"
									name="reg-log"
									checked={isSignUp}
									onChange={(event) => setIsSignUp(event.target.checked)}
								/>
								<label htmlFor="reg-log" aria-hidden="true" />
								<div className="card-3d-wrap mx-auto">
									<div className="card-3d-wrapper">
										<form className="card-front" onSubmit={handleLogin}>
											<div className="center-wrap">
												<div className="section text-center font">
													<h4 className="mb-4 pb-3">Log In</h4>
													{!loginMfaRequired ? (
														<>
															<div className="form-group font">
																<input
																	type="email"
																	name="email"
																	className="form-style"
																	placeholder="example@gmail.com"
																	value={loginEmail}
																	onChange={(event) => setLoginEmail(event.target.value)}
																	autoComplete="username"
																	required
																/>
																<AtSignIcon className="input-icon" size={18} />
															</div>
															<div className="form-group mt-2">
																<input
																	type={loginPasswordVisible ? "text" : "password"}
																	name="logpass"
																	className="form-style"
																	placeholder="Your Password"
																	value={loginPassword}
																	onChange={(event) => setLoginPassword(event.target.value)}
																	autoComplete="current-password"
																	required
																/>
																<button
																	type="button"
																	className="input-toggle"
																	aria-label={
																		loginPasswordVisible ? "Hide password" : "Show password"
																	}
																	onClick={() => setLoginPasswordVisible((v) => !v)}
																>
																	{loginPasswordVisible ? (
																		<EyeOffIcon size={18} />
																	) : (
																		<EyeIcon size={18} />
																	)}
																</button>
																<LockIcon className="input-icon" size={18} />
															</div>
														</>
													) : (
														<div className="form-group mt-2">
															<input
																type="text"
																name="mfa-code"
																className="form-style"
																placeholder="Authenticator code"
																value={loginMfaCode}
																onChange={(event) =>
																	setLoginMfaCode(
																		event.target.value.replace(/\D/g, "").slice(0, 8),
																	)
																}
																autoComplete="one-time-code"
																required
															/>
															<LockIcon className="input-icon" size={18} />
														</div>
													)}
													<button
														type={loginMfaRequired ? "button" : "submit"}
														className="btn mt-4"
														onClick={loginMfaRequired ? verifyLoginMfa : undefined}
														style={{
															width: "40%",
															display: "inline-flex",
															alignItems: "center",
															justifyContent: "center",
															gap: "8px",
														}}
													>
														<UserPlusIcon size={20} />
														{loginMfaRequired ? "Verify 2FA" : "Log In"}
													</button>
													{!loginMfaRequired && (
														<>
															<div className="auth-divider" aria-hidden="true">
																<span>or continue with</span>
															</div>
															<div
																className="social-auth-row"
																role="group"
																aria-label="Social login options"
															>
																<button
																	type="button"
																	className="social-auth-btn social-auth-btn--google"
																	onClick={() => handleSocialAuth("google")}
																	disabled={Boolean(socialProviderLoading)}
																>
																	<BrandGoogleIcon size={18} />
																	<span>
																		{socialProviderLoading === "google"
																			? "Redirecting..."
																			: "Continue with Google"}
																	</span>
																</button>
															</div>
														</>
													)}
													{loginMfaRequired && (
														<p className="mb-0 mt-3 text-center">
															<a
																href="#back"
																className="link"
																onClick={(event) => {
																	event.preventDefault();
																	setLoginMfaRequired(false);
																	setLoginChallengeToken("");
																	setLoginMfaCode("");
																}}
															>
																Back to password login
															</a>
														</p>
													)}
													<p className="mb-0 mt-4 text-center">
														<a href="#forgot" className="link" onClick={handleForgot}>
															Forgot your password?
														</a>
													</p>
												</div>
											</div>
										</form>
										<form className="card-back" onSubmit={handleSignUp}>
											<div className="center-wrap">
												<div className="section text-center font">
													<h4 className="mb-4 pb-3">Sign Up</h4>
													<div className="form-group">
														<input
															type="text"
															name="logname"
															className="form-style"
															placeholder="Your Full Name"
															value={signName}
															onChange={(event) => setSignName(event.target.value)}
															autoComplete="name"
															required
														/>
														<UserPlusIcon className="input-icon" size={18} />
													</div>
													<div className="form-group mt-2">
														<input
															type="text"
															name="username"
															className="form-style"
															placeholder="Choose a username"
															value={signUsername}
															onChange={(event) => setSignUsername(event.target.value)}
															autoComplete="username"
															required
														/>
														<AtSignIcon className="input-icon" size={18} />
													</div>
													<div className="form-group mt-2">
														<input
															type="email"
															name="logemail"
															className="form-style"
															placeholder="example@gmail.com"
															value={signEmail}
															onChange={(event) => setSignEmail(event.target.value)}
															autoComplete="email"
															required
														/>
														<AtSignIcon className="input-icon" size={18} />
													</div>
													<div className="form-group mt-2">
														<input
															type={signPasswordVisible ? "text" : "password"}
															name="logpass"
															className="form-style"
															placeholder="Your Password"
															value={signPassword}
															onChange={(event) => setSignPassword(event.target.value)}
															autoComplete="new-password"
															required
														/>
														<button
															type="button"
															className="input-toggle"
															aria-label={signPasswordVisible ? "Hide password" : "Show password"}
															onClick={() => setSignPasswordVisible((v) => !v)}
														>
															{signPasswordVisible ? (
																<EyeOffIcon size={18} />
															) : (
																<EyeIcon size={18} />
															)}
														</button>
														<LockIcon className="input-icon" size={18} />
													</div>
													<div style={{ marginTop: 16, marginBottom: 8 }}>
														<AccountIconGenerator
															username={signUsername || signName}
															onChange={(d) => setSignIconDataUrl(d)}
														/>
													</div>
													<div className="auth-divider" aria-hidden="true">
														<span>or continue with</span>
													</div>
													<div
														className="social-auth-row"
														role="group"
														aria-label="Social sign up options"
													>
														<button
															type="button"
															className="social-auth-btn social-auth-btn--google"
															onClick={() => handleSocialAuth("google")}
															disabled={Boolean(socialProviderLoading)}
														>
															<BrandGoogleIcon size={18} />
															<span>
																{socialProviderLoading === "google"
																	? "Redirecting..."
																	: "Continue with Google"}
															</span>
														</button>
													</div>
													<div
														style={{
															width: "80%",
															height: "1px",
															background:
																"linear-gradient(90deg, transparent, rgba(255, 185, 115, 0.3), transparent)",
															margin: "20px auto 0",
														}}
													/>
													<button
														type="submit"
														className="btn mt-4"
														style={{
															display: "inline-flex",
															alignItems: "center",
															justifyContent: "center",
															gap: "8px",
														}}
													>
														<UserPlusIcon size={20} />
														Create Account
													</button>
												</div>
											</div>
										</form>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>
	);
});
