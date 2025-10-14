"use client";

import { useCallback, useState, type FormEvent, type MouseEvent } from "react";
import { useNotifications } from "@/components/NotificationsProvider";
import { useRouter } from "next/navigation";
import { Poppins } from "next/font/google";

const ALLOWED_EMAIL_SUFFIXES = ["@gmail.com", "@outlook.com", "@yahoo.com"];

const poppins = Poppins({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700", "800", "900"],
	variable: "--font-poppins",
});

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
	const [signEmail, setSignEmail] = useState("");
	const [signPassword, setSignPassword] = useState("");
	const [signPasswordVisible, setSignPasswordVisible] = useState(false);

	const { notify } = useNotifications();

	const handleSignUp = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const nickname = signName.trim();
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
			if (!hasAllowedDomain || !nickname || !hasSingleAt(email)) {
				notify(
					"Invalid e-mail address or empty username, please insert a valid e-mail address and a username!",
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

			if (typeof window !== "undefined") {
				localStorage.setItem("passValue", password);
				localStorage.setItem("nameValue", nickname);
				localStorage.setItem("mailValue", email);
				localStorage.setItem("forgotValue", "false");
				localStorage.setItem("account_made", "true");
				localStorage.setItem("account_log", "true");
			}

			notify(
				`Welcome ${nickname}, your account was registered with the following address ${email}`,
				6000,
				"success",
				"account"
			);
			setIsSignUp(false);
			setLoginEmail(email);
			setLoginPassword("");
			setSignPassword("");
			setSignName("");
			router.push("/");
		},
		[router, notify, signEmail, signName, signPassword]
	);

	const attemptLogin = useCallback(() => {
		if (typeof window === "undefined") return false;
		const email = loginEmail.trim();
		const password = loginPassword;
		const storedPass = localStorage.getItem("passValue");
		const storedMail = localStorage.getItem("mailValue");
		const storedName = localStorage.getItem("nameValue");
		const forgotValue = localStorage.getItem("forgotValue") ?? "false";
		const accountMade = localStorage.getItem("account_made") === "true";

		if (!accountMade) {
			notify("You need to make an account first!", 6000, "error", "account");
			return false;
		}

		if (forgotValue === "false") {
			if (storedMail !== email || storedPass !== password) {
				notify("Your e-mail address or password is incorrect!", 6000, "error", "account");
				return false;
			}
			localStorage.setItem("account_log", "true");
			localStorage.setItem("forgotValue", "false");
			notify(`Welcome back ${formatNamePlaceholder(storedName)}, here at the Filspresso!`, 6000, "success", "account");
			setLoginPassword("");
			setLoginEmail(email);
			router.push("/");
			return true;
		}

		if (!password) {
			notify("Please insert a strong password!", 6000, "error", "account");
			return false;
		}
		if (password.length < 10) {
			notify("Your password is too short, it must contain at least 10 characters!", 6000, "error", "account");
			return false;
		}
		if (!containsSpecialCharsPassword(password)) {
			notify("Your password is weak, it must contain special characters as well!", 6000, "error", "account");
			return false;
		}

		localStorage.setItem("passValue", password);
		notify("Your password has been changed!", 6000, "success", "account");
		notify(`Welcome back ${formatNamePlaceholder(storedName)}, here at the Filspresso!`, 6000, "success", "account");
		localStorage.setItem("account_log", "true");
		localStorage.setItem("forgotValue", "false");
		setLoginPassword("");
		setLoginEmail(email);
		router.push("/");
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
			if (typeof window !== "undefined") {
				localStorage.setItem("forgotValue", "true");
			}
			notify(
				"We're sorry that you forgot your password, you'll need to enter your e-mail address and the new password in the Log In form.",
				6000,
				"info",
				"account"
			);
			attemptLogin();
		},
		[attemptLogin, notify]
	);

	return (
		<main className={`account-page ${poppins.variable}`}>
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
														submit
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
													<button type="submit" className="btn mt-4">
														submit
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
