"use client";

import AccountIconGenerator from "@/components/AccountIconGenerator";
import { AccountData, gradientTextStyle } from "./types";

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
		total: number;
	};
	setIsEditing: (val: boolean) => void;
	setEditFullName: (val: string) => void;
	setEditEmail: (val: string) => void;
	setNewPassword: (val: string) => void;
	setConfirmPassword: (val: string) => void;
	setEditIconDataUrl: (val: string | null) => void;
	handleSaveProfile: () => void;
	handleChangePassword: () => void;
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
}: ProfileSectionProps) {
	return (
		<div className="tab-pane fade-in">
			<div className="card">
				<div className="card-header">
					<h2>Personal Information</h2>
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
					<h2>Security</h2>
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
				</div>
			</div>

			{/* Total Spending Card */}
			<div className="card">
				<div className="card-header">
					<h2>💰 How Much Did You Spend With Us</h2>
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
							gridTemplateColumns: "repeat(3, 1fr)",
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
								textAlign: "center",
							}}
						>
							<div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>☕</div>
							<div style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.25rem" }}>Capsules & Acc.</div>
							<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
								{totalSpending.products.toFixed(2)} RON
							</div>
						</div>
						<div
							style={{
								background: "#1a1a1a",
								borderRadius: "12px",
								padding: "1rem",
								textAlign: "center",
							}}
						>
							<div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>🎫</div>
							<div style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.25rem" }}>Subscriptions</div>
							<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
								{totalSpending.subscriptions.toFixed(2)} RON
							</div>
						</div>
						<div
							style={{
								background: "#1a1a1a",
								borderRadius: "12px",
								padding: "1rem",
								textAlign: "center",
							}}
						>
							<div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>⚙️</div>
							<div style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.25rem" }}>Machines</div>
							<div style={{ fontSize: "1.1rem", fontWeight: 600, ...gradientTextStyle }}>
								{totalSpending.machines.toFixed(2)} RON
							</div>
						</div>
					</div>

					{/* Thank you message */}
					<div
						style={{
							marginTop: "1rem",
							padding: "0.75rem 1rem",
							background: "rgba(16, 185, 129, 0.1)",
							border: "1px solid rgba(16, 185, 129, 0.3)",
							borderRadius: "8px",
							textAlign: "center",
							fontSize: "0.9rem",
							color: "#10b981",
						}}
					>
						Thank you for being a valued Filspresso customer! ☕
					</div>
				</div>
			</div>
		</div>
	);
}
