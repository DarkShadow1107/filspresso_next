"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import "@/styles/admin.css";
import { EyeIcon, EyeOffIcon, LockIcon, QrCodeIcon, UserCheckIcon } from "@/icons";
import { InlineLoadingSpinner } from "@/components/loading/ProgressiveLoading";

export default function AdminLoginClient() {
	const router = useRouter();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [totpCode, setTotpCode] = useState("");
	const [challengeToken, setChallengeToken] = useState("");
	const [mfaPhase, setMfaPhase] = useState<"credentials" | "verify">("credentials");
	const [requiresEnrollment, setRequiresEnrollment] = useState(false);
	const [totpSecret, setTotpSecret] = useState("");
	const [otpAuthUrl, setOtpAuthUrl] = useState("");
	const [totpQrDataUrl, setTotpQrDataUrl] = useState("");
	const [includeQrCode, setIncludeQrCode] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [loginError, setLoginError] = useState("");

	const completeLogin = () => {
		setPassword("");
		setTotpCode("");
		setTotpQrDataUrl("");
		setIncludeQrCode(false);
		router.replace("/admin");
	};

	const handleCredentialsLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoginError("");
		setIsLoading(true);

		try {
			const response = await fetch(`/api/admin/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password, includeQrCode: true }),
			});
			const data = await response.json();

			if (response.ok && data?.status === "success") {
				completeLogin();
				return;
			}

			if (response.status === 202 && data?.challengeToken) {
				setChallengeToken(String(data.challengeToken));
				setMfaPhase("verify");
				setRequiresEnrollment(Boolean(data?.requiresMfaEnrollment));
				setTotpSecret(String(data?.totp?.secret || ""));
				setOtpAuthUrl(String(data?.totp?.otpauthUrl || ""));
				setTotpQrDataUrl(String(data?.totp?.qrDataUrl || ""));
				setIncludeQrCode(false);
				setPassword("");
				return;
			}

			if (!response.ok) {
				setLoginError(data?.error || "Login failed");
				return;
			}

			setLoginError("Login failed");
		} catch {
			setLoginError("Failed to connect to server");
		} finally {
			setIsLoading(false);
		}
	};

	const handleMfaVerify = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoginError("");
		setIsLoading(true);

		try {
			const response = await fetch(`/api/admin/mfa/verify`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ challengeToken, code: totpCode }),
			});
			const data = await response.json();

			if (!response.ok || data?.status !== "success") {
				setLoginError(data?.error || "MFA verification failed");
				return;
			}

			completeLogin();
		} catch {
			setLoginError("Failed to connect to server");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="admin-login-container">
			<div className="admin-login-card">
				<div className="admin-login-header">
					<span className="admin-login-kicker">Filspresso Control Room</span>
					<h1 className="admin-login-title">
						<span className="admin-icon admin-icon--lg">
							<LockIcon size={18} />
						</span>
						Admin Panel Login
					</h1>
					<p className="admin-login-copy">Sign in with an administrator account to access operations tools.</p>
				</div>
				{mfaPhase === "credentials" ? (
					<form onSubmit={handleCredentialsLogin} className="admin-login-form">
						<div className="form-group">
							<label htmlFor="username">Username</label>
							<input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder="Admin username"
								autoComplete="username"
								required
							/>
						</div>
						<div className="form-group">
							<label htmlFor="password">Password</label>
							<div className="password-input-wrapper">
								<input
									id="password"
									type={showPassword ? "text" : "password"}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="Admin password"
									autoComplete="current-password"
									required
									className="admin-password-input"
								/>
								<button
									type="button"
									onClick={() => setShowPassword((current) => !current)}
									className="password-toggle-btn"
									title={showPassword ? "Hide password" : "Show password"}
								>
									{showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
								</button>
							</div>
						</div>
						{loginError && <div className="error-message">{loginError}</div>}
						<button type="submit" className="login-button" disabled={isLoading}>
							{isLoading ? (
								<span className="inline-flex items-center gap-3">
									<InlineLoadingSpinner className="h-4 w-4 text-current" />
									<span>Verifying credentials...</span>
								</span>
							) : (
								<>
									<UserCheckIcon size={20} /> <span className="login-button-label">Continue</span>
								</>
							)}
						</button>
					</form>
				) : (
					<form onSubmit={handleMfaVerify} className="admin-login-form">
						{requiresEnrollment && (
							<div className="form-group">
								<label>Authenticator Setup (required once)</label>
								<p className="admin-login-copy">
									Add this secret in your authenticator app, then enter the generated code.
								</p>
								<button
									type="button"
									className={`admin-mfa-toggle-btn ${includeQrCode ? "is-active" : ""}`}
									onClick={() => setIncludeQrCode((value) => !value)}
									style={{ marginTop: "0.35rem", marginBottom: "0.65rem" }}
								>
									<QrCodeIcon size={16} />
									<span>{includeQrCode ? "Use text key" : "Use QR code"}</span>
								</button>
								<input type="text" value={totpSecret} readOnly className="admin-password-input" />
								{includeQrCode && totpQrDataUrl && (
									<img
										src={totpQrDataUrl}
										alt="Admin authenticator QR code"
										style={{ width: 200, height: 200, marginTop: "0.75rem", borderRadius: "10px" }}
									/>
								)}
								{otpAuthUrl && (
									<a href={otpAuthUrl} className="forgot-password-link">
										Open in authenticator app
									</a>
								)}
							</div>
						)}
						<div className="form-group">
							<label htmlFor="totp-code">One-time code</label>
							<input
								id="totp-code"
								type="text"
								inputMode="numeric"
								pattern="[0-9]{6,8}"
								value={totpCode}
								onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
								placeholder="123456"
								autoComplete="one-time-code"
								required
							/>
						</div>
						{loginError && <div className="error-message">{loginError}</div>}
						<button type="submit" className="login-button" disabled={isLoading}>
							{isLoading ? (
								<span className="inline-flex items-center gap-3">
									<InlineLoadingSpinner className="h-4 w-4 text-current" />
									<span>Verifying MFA...</span>
								</span>
							) : (
								"Complete Secure Login"
							)}
						</button>
					</form>
				)}
			</div>
		</div>
	);
}
