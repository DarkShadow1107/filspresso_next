const React = require("react");
const { render } = require("@react-email/render");
const { EmailVerificationTemplate } = require("../emails/EmailVerificationTemplate");
const { OrderUpdateTemplate } = require("../emails/OrderUpdateTemplate");
const { WelcomeTemplate } = require("../emails/WelcomeTemplate");
const { SecurityLoginTemplate } = require("../emails/SecurityLoginTemplate");

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || "";
const FRONTEND_ORIGIN =
	process.env.FRONTEND_ORIGIN ||
	process.env.NEXT_PUBLIC_FRONTEND_URL ||
	String(process.env.CORS_ORIGIN || "http://localhost:3000")
		.split(",")[0]
		.trim() ||
	"http://localhost:3000";

function escapeHtml(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function formatMoney(value, currency = "RON") {
	const amount = Number(value || 0);
	return `${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"} ${currency}`;
}

function toAbsoluteImageUrl(imageUrl) {
	if (!imageUrl || typeof imageUrl !== "string") return "";
	if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) return imageUrl;
	if (imageUrl.startsWith("/")) {
		return `${FRONTEND_ORIGIN.replace(/\/$/, "")}${imageUrl}`;
	}
	return `${FRONTEND_ORIGIN.replace(/\/$/, "")}/${imageUrl.replace(/^\/+/, "")}`;
}

function buildOrderEmailHtml({
	title,
	intro,
	orderNumber,
	status,
	orderDate,
	shippingAddress,
	currencyCode,
	subtotal,
	discountAmount,
	shippingCost,
	tax,
	total,
	items,
	extraNote,
}) {
	const normalizedItems = (Array.isArray(items) ? items : []).map((item) => ({
		...item,
		productImage: toAbsoluteImageUrl(item.productImage || item.product_image || ""),
	}));

	return render(
		React.createElement(OrderUpdateTemplate, {
			title,
			intro,
			orderNumber,
			status,
			orderDate,
			shippingAddress,
			currencyCode,
			subtotal,
			discountAmount,
			shippingCost,
			tax,
			total,
			items: normalizedItems,
			extraNote,
		}),
	);
}

function buildEmailVerificationHtml({ displayName, verificationUrl }) {
	return render(
		React.createElement(EmailVerificationTemplate, {
			displayName,
			verificationUrl,
		}),
	);
}

function buildWelcomeHtml({ displayName, accountUrl }) {
	return render(
		React.createElement(WelcomeTemplate, {
			displayName,
			accountUrl,
		}),
	);
}

function buildSecurityLoginHtml({ displayName, ipAddress, userAgent, occurredAt }) {
	return render(
		React.createElement(SecurityLoginTemplate, {
			displayName,
			ipAddress,
			userAgent,
			occurredAt,
		}),
	);
}

async function sendTransactionalEmail({ to, subject, html, text, attachments = [] }) {
	if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !to || !subject || !html) {
		return { ok: false, skipped: true };
	}

	const payload = {
		from: RESEND_FROM_EMAIL,
		to: Array.isArray(to) ? to : [to],
		subject,
		html,
		text: text || undefined,
		attachments: attachments.length > 0 ? attachments : undefined,
		reply_to: RESEND_REPLY_TO || undefined,
	};

	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${RESEND_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`Resend email failed (${response.status}): ${body}`);
	}

	const data = await response.json().catch(() => ({}));
	return { ok: true, data };
}

module.exports = {
	sendTransactionalEmail,
	buildEmailVerificationHtml,
	buildOrderEmailHtml,
	buildWelcomeHtml,
	buildSecurityLoginHtml,
	escapeHtml,
	formatMoney,
	toAbsoluteImageUrl,
};
