"use client";

import AccountIconGenerator from "@/components/AccountIconGenerator";
import { AccountData, gradientTextStyle } from "./types";
import {
	CoffeeIcon,
	RosetteDiscountIcon,
	GearIcon,
	UserCheckIcon as UserIcon,
	LockIcon,
	ChartBarIcon,
	QrCodeIcon,
} from "@/icons";

type ProfileSectionProps = {
	account: AccountData;
	isEditing: boolean;
	editFullName: string;
	editEmail: string;
	newPassword: string;
	confirmPassword: string;
	totalSpending: {
		orders: number;
		subscriptions: number;
		machines: number;
		products: number;
		taxes: number;
		total: number;
		preferredCurrency: string;
		totalOrders: number;
		currencyUsage: Array<{
			currencyCode: string;
			orderCount: number;
			chargedTotal: number;
			ronEquivalentTotal: number;
			conversionTaxesRon: number;
			percentage: number;
		}>;
	};
	setIsEditing: (val: boolean) => void;
	setEditFullName: (val: string) => void;
	setEditEmail: (val: string) => void;
	setNewPassword: (val: string) => void;
	setConfirmPassword: (val: string) => void;
	setEditIconDataUrl: (val: string | null) => void;
	handleSaveProfile: () => void;
	handleChangePassword: () => void;
	mfaSetup: {
		challengeToken: string;
		expiresIn: number;
		totp: {
			secret: string;
			issuer: string;
			accountName: string;
			otpauthUrl: string;
			qrDataUrl?: string | null;
		};
	} | null;
	mfaCode: string;
	mfaIncludeQrCode: boolean;
	setMfaCode: (val: string) => void;
	setMfaIncludeQrCode: (val: boolean) => void;
	handleStartMfaSetup: () => void;
	handleEnableMfa: () => void;
};

export function ProfileSection({
	account,
	isEditing,
	editFullName,
	editEmail,
	newPassword,
	confirmPassword,
	totalSpending,
	setIsEditing,
	setEditFullName,
	setEditEmail,
	setNewPassword,
	setConfirmPassword,
	setEditIconDataUrl,
	handleSaveProfile,
	handleChangePassword,
	mfaSetup,
	mfaCode,
	mfaIncludeQrCode,
	setMfaCode,
	setMfaIncludeQrCode,
	handleStartMfaSetup,
	handleEnableMfa,
}: ProfileSectionProps) {
	const isMultiCurrencyUser = totalSpending.currencyUsage.length > 1;

	return (
		<div className="tab-pane fade-in">
			<div className="card">
				<div className="card-header">
					<h2 style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
						<UserIcon size={24} /> Personal Information
					</h2>
					{!isEditing && <button onClick={() => setIsEditing(true)}>Edit</button>}
				</div>
				{isEditing ? (
					<div className="form-grid">
						<div className="form-group">
							<label>Full Name</label>
							<input value={editFullName} onChange={(e) => setEditFullName(e.target.value)} />
						</div>
						<div className="form-group">
							<label>Email</label>
							<input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
						</div>
						<div className="form-group full-width">
							<label>Profile Icon</label>
							<AccountIconGenerator username={account.username} onChange={setEditIconDataUrl} />
						</div>
						<div className="form-actions">
							<button className="btn-primary" onClick={handleSaveProfile}>
								Save Changes
							</button>
							<button className="btn-secondary" onClick={() => setIsEditing(false)}>
								Cancel
							</button>
						</div>
					</div>
				) : (
					<div className="info-grid">
						<div className="info-item">
							<label>Username</label>
							<p>{account.username}</p>
						</div>
						<div className="info-item">
							<label>Full Name</label>
							<p>{account.full_name || "Not set"}</p>
						</div>
						<div className="info-item">
							<label>Email</label>
							<p>{account.email}</p>
						</div>
					</div>
				)}
			</div>

			<div className="card">
				<div className="card-header">
					<h2 style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
						<LockIcon size={24} /> Security
					</h2>
				</div>
				<div className="form-grid">
					<div className="form-group">
						<label>New Password</label>
						<input
							type="password"
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							placeholder="••••••••"
						/>
					</div>
					<div className="form-group">
						<label>Confirm Password</label>
						<input
							type="password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							placeholder="••••••••"
						/>
					</div>
					<div className="form-actions">
						<button className="btn-primary" onClick={handleChangePassword}>
							Update Password
						</button>
					</div>
					<div className="form-group full-width" style={{ marginTop: "1rem" }}>
						<label>Two-factor authentication (Authenticator app)</label>
						<p style={{ color: "#aaa", margin: "0.25rem 0 0.5rem" }}>
							Status: {account.mfa?.enabled ? "Enabled" : "Not enabled"}
						</p>
						{!account.mfa?.enabled && (
							<div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
								<div className="form-actions" style={{ justifyContent: "center" }}>
									<button className="btn-primary" onClick={handleStartMfaSetup}>
										Enable 2FA
									</button>
								</div>

								{mfaSetup && (
									<div
										style={{
											marginTop: "0.5rem",
											padding: "0.9rem",
											border: "1px solid rgba(196, 167, 125, 0.35)",
											borderRadius: "12px",
											background: "rgba(196, 167, 125, 0.08)",
										}}
									>
										<p style={{ margin: 0, color: "#ddd" }}>
											Secret: <strong>{mfaSetup.totp.secret}</strong>
										</p>
										<button
											type="button"
											className={`btn-primary mfa-toggle-btn ${mfaIncludeQrCode ? "is-active" : ""}`}
											onClick={() => setMfaIncludeQrCode(!mfaIncludeQrCode)}
											style={{ marginTop: "0.7rem" }}
										>
											<QrCodeIcon size={16} />
											<span>{mfaIncludeQrCode ? "Use text key" : "Use QR code"}</span>
										</button>
										{mfaIncludeQrCode && mfaSetup.totp.qrDataUrl && (
											<img
												src={mfaSetup.totp.qrDataUrl}
												alt="Authenticator QR code"
												style={{ width: 180, height: 180, marginTop: "0.8rem", borderRadius: "10px" }}
											/>
										)}
										{mfaSetup.totp.otpauthUrl && (
											<a href={mfaSetup.totp.otpauthUrl} style={{ display: "block", marginTop: "0.6rem" }}>
												Open in authenticator app
											</a>
										)}
										<input
											type="text"
											inputMode="numeric"
											pattern="[0-9]{6,8}"
											value={mfaCode}
											onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
											placeholder="Enter app code"
											style={{ marginTop: "0.7rem" }}
										/>
										<div className="form-actions" style={{ marginTop: "0.6rem" }}>
											<button className="btn-primary" onClick={handleEnableMfa}>
												Enable 2FA
											</button>
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Total Spending Card */}
			<div className="card">
				<div className="card-header">
					<h2 style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
						<ChartBarIcon size={24} /> Spending Analytics
					</h2>
					<span style={{ color: "#aaa", fontSize: "0.9rem" }}>
						Preferred currency: {totalSpending.preferredCurrency}
					</span>
				</div>
				<div
					style={{
						background: "linear-gradient(135deg, rgba(196, 167, 125, 0.1) 0%, rgba(166, 124, 82, 0.1) 100%)",
						border: "1px solid rgba(196, 167, 125, 0.3)",
						borderRadius: "16px",
						padding: "1.5rem",
						marginTop: "1rem",
					}}
				>
					{/* Total Amount - Large Display */}
					<div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
						<div
							style={{
								fontSize: "0.9rem",
								color: "#888",
								marginBottom: "0.5rem",
								textTransform: "uppercase",
								letterSpacing: "1px",
							}}
						>
							Total Lifetime Spending
						</div>
						<div
							style={{
								fontSize: "3rem",
								fontWeight: 700,
								...gradientTextStyle,
							}}
						>
							{totalSpending.total.toFixed(2)} <span style={{ fontSize: "1.5rem" }}>RON</span>
						</div>
					</div>

					{/* Breakdown */}
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
							gap: "1rem",
							paddingTop: "1rem",
							borderTop: "1px solid rgba(196, 167, 125, 0.2)",
						}}
					>
						<div
							style={{
								background: "#1a1a1a",
								borderRadius: "12px",
								padding: "1rem",
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: "0.5rem",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
								<CoffeeIcon size={20} color="#ae8966" />
								<span style={{ fontSize: "0.8rem", color: "#888" }}>Capsules & Accessories</span>
							</div>
							<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
								{totalSpending.products.toFixed(2)} RON
							</div>
						</div>
						<div
							style={{
								background: "#1a1a1a",
								borderRadius: "12px",
								padding: "1rem",
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: "0.5rem",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
								<RosetteDiscountIcon size={20} color="#ae8966" />
								<span style={{ fontSize: "0.8rem", color: "#888" }}>Subscriptions</span>
							</div>
							<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
								{totalSpending.subscriptions.toFixed(2)} RON
							</div>
						</div>
						<div
							style={{
								background: "#1a1a1a",
								borderRadius: "12px",
								padding: "1rem",
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: "0.5rem",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
								<GearIcon size={20} color="#ae8966" />
								<span style={{ fontSize: "0.8rem", color: "#888" }}>Machines</span>
							</div>
							<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
								{totalSpending.machines.toFixed(2)} RON
							</div>
						</div>
						<div
							style={{
								background: "#1a1a1a",
								borderRadius: "12px",
								padding: "1rem",
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: "0.5rem",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
								<ChartBarIcon size={20} color="#ae8966" />
								<span style={{ fontSize: "0.8rem", color: "#888" }}>Conversion taxes</span>
							</div>
							<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
								{totalSpending.taxes.toFixed(2)} RON
							</div>
						</div>
					</div>

					{isMultiCurrencyUser && (
						<div
							style={{
								marginTop: "1.25rem",
								paddingTop: "1.1rem",
								borderTop: "1px solid rgba(196, 167, 125, 0.2)",
							}}
						>
							<div style={{ fontSize: "0.9rem", color: "#aaa", marginBottom: "0.75rem" }}>
								Currency usage by RON equivalent spending
							</div>
							<div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
								{totalSpending.currencyUsage.map((entry) => (
									<div
										key={entry.currencyCode}
										style={{ display: "grid", gridTemplateColumns: "86px 1fr auto", gap: "0.6rem" }}
									>
										<span style={{ color: "#ddd", fontWeight: 600 }}>{entry.currencyCode}</span>
										<div
											style={{
												height: "10px",
												borderRadius: "999px",
												background: "#1f1f1f",
												overflow: "hidden",
												border: "1px solid #2e2e2e",
											}}
										>
											<div
												style={{
													height: "100%",
													width: `${Math.max(4, Math.min(100, entry.percentage))}%`,
													background: "linear-gradient(90deg, #c4a77d 0%, #a67c52 100%)",
												}}
											/>
										</div>
										<span style={{ color: "#bbb", fontSize: "0.85rem" }}>
											{entry.ronEquivalentTotal.toFixed(2)} RON ({entry.percentage.toFixed(2)}%)
										</span>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Thank you message */}
					<div
						style={{
							marginTop: "1.5rem",
							padding: "1.5rem 1rem",
							background: "rgba(16, 185, 129, 0.1)",
							border: "1px solid rgba(16, 185, 129, 0.3)",
							borderRadius: "12px",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							gap: "0.75rem",
							textAlign: "center",
						}}
					>
						<CoffeeIcon size={32} color="#10b981" />
						<span style={{ fontSize: "1.05rem", fontWeight: 500, color: "#fff" }}>
							Thank you for being a valued Filspresso customer!
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
