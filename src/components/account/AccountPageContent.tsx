"use client";

import { useCallback, useState, type FormEvent, type MouseEvent } from "react";
import AccountIconGenerator from "@/components/AccountIconGenerator";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";

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

export default function AccountPageContent() {
	const router = useRouter();
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

	const { notify } = useNotifications();

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
					"account"
				);
				return;
			}

			const hasAllowedDomain = ALLOWED_EMAIL_SUFFIXES.some((suffix) => email.endsWith(suffix));
			if (!hasAllowedDomain || !nickname || !username || !hasSingleAt(email)) {
				notify(
					"Invalid e-mail address or empty full name/username, please insert a valid e-mail address and a username!",
					6000,
					"error",
					"account"
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
			if (signIconDataUrl && typeof window !== "undefined") {
				try {
					const iconRes = await fetch("http://localhost:5000/api/icons/save", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ username, svg: signIconDataUrl }),
					});
					const iconData = await iconRes.json();
					if (iconData.status === "success") {
						savedIconPath = iconData.icon_path;
					}
				} catch (e) {
					console.error("Failed to save icon:", e);
				}
			}

			// Try to persist account to backend
			const payload = {
				full_name: nickname,
				username,
				email,
				password,
				icon: savedIconPath || signIconDataUrl,
			};
			if (typeof window !== "undefined") {
				fetch("http://localhost:4000/api/auth/register", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				})
					.then((res) => res.json())
					.then((data) => {
						if (data?.status === "success") {
							// Use the static icon URL from Python server
							const iconUrl = savedIconPath || data.icon_path || null;
							const token = data.token || null;
							sessionStorage.setItem(
								"account_session",
								JSON.stringify({ full_name: nickname, username, email, icon: iconUrl, token })
							);
							// Notify Navbar of session change
							window.dispatchEvent(new Event("session-update"));
							notify(
								`Welcome ${nickname}, your account was registered with the following address ${email}`,
								6000,
								"success",
								"account"
							);
						} else {
							notify(data?.message || "Failed to create account", 6000, "error", "account");
							return;
						}
					})
					.catch((error) => {
						console.error("Signup error:", error);
						notify("Failed to create account. Please check your connection.", 6000, "error", "account");
						return;
					});
			}

			setIsSignUp(false);
			setLoginEmail(username);
			setLoginPassword("");
			setSignPassword("");
			setSignName("");
			setTimeout(() => router.push("/"), 1500);
		},
		[router, notify, signEmail, signName, signPassword, signUsername, signIconDataUrl]
	);

	const attemptLogin = useCallback(() => {
		if (typeof window === "undefined") return false;
		const username = loginEmail.trim();
		const password = loginPassword;

		if (!username || !password) {
			notify("Username and password are required!", 6000, "error", "account");
			return false;
		}

		// Use backend login endpoint
		fetch("http://localhost:4000/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password }),
		})
			.then((res) => res.json())
			.then((data) => {
				if (data?.status === "success" && data?.account) {
					const account = data.account;
					const token = data.token || null;
					sessionStorage.setItem(
						"account_session",
						JSON.stringify({
							full_name: account.full_name,
							username: account.username,
							email: account.email,
							icon: account.icon,
							token,
						})
					);
					// Notify Navbar of session change
					window.dispatchEvent(new Event("session-update"));
					notify(`Welcome back ${account.full_name || account.username}!`, 6000, "success", "account");
					setLoginPassword("");
					setLoginEmail("");
					router.push("/");
				} else {
					notify(data?.message || "Invalid username or password!", 6000, "error", "account");
				}
			})
			.catch((error) => {
				console.error("Login error:", error);
				notify("Login failed. Please check your connection.", 6000, "error", "account");
			});

		return true;
	}, [loginEmail, loginPassword, router, notify]);

	const handleLogin = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			attemptLogin();
		},
		[attemptLogin]
	);

	const handleForgot = useCallback(
		(event: MouseEvent<HTMLAnchorElement>) => {
			event.preventDefault();
			notify(
				"Password reset is not yet implemented. Please create a new account or contact support.",
				6000,
				"info",
				"account"
			);
		},
		[notify]
	);

	return (
		<main className="account-page">
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
														<i className="input-icon uil uil-at" aria-hidden="true" />
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
															aria-label={loginPasswordVisible ? "Hide password" : "Show password"}
															onClick={() => setLoginPasswordVisible((v) => !v)}
														>
															<i
																className={`uil ${
																	loginPasswordVisible ? "uil-eye" : "uil-eye-slash"
																}`}
																aria-hidden="true"
															/>
														</button>
														<i className="input-icon uil uil-lock-alt" aria-hidden="true" />
													</div>
													<button type="submit" className="btn mt-4">
														Log In
													</button>
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
														<i className="input-icon uil uil-user" aria-hidden="true" />
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
														<i className="input-icon uil uil-at" aria-hidden="true" />
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
														<i className="input-icon uil uil-at" aria-hidden="true" />
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
															<i
																className={`uil ${
																	signPasswordVisible ? "uil-eye" : "uil-eye-slash"
																}`}
																aria-hidden="true"
															/>
														</button>
														<i className="input-icon uil uil-lock-alt" aria-hidden="true" />
													</div>
													<div style={{ marginTop: 16, marginBottom: 8 }}>
														<AccountIconGenerator
															username={signUsername || signName}
															onChange={(d) => setSignIconDataUrl(d)}
														/>
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
													<button type="submit" className="btn mt-4">
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
}
