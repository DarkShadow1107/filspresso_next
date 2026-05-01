type MailPayload = {
	to: string;
	subject: string;
	text?: string;
	html?: string;
	from?: string;
	replyTo?: string;
};

const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const MAIL_FROM = String(process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL || "Filspresso <noreply@filspresso.com>").trim();
const MAIL_REPLY_TO = String(process.env.MAIL_REPLY_TO || process.env.RESEND_REPLY_TO || "").trim();
const FRONTEND_ORIGIN = String(
	process.env.FRONTEND_ORIGIN ||
		process.env.NEXT_PUBLIC_FRONTEND_URL ||
		String(process.env.CORS_ORIGIN || "http://localhost:3000")
			.split(",")[0]
			.trim() ||
		"http://localhost:3000",
).replace(/\/$/, "");

function getResendApiKey(): string {
	const runtimeKey = String(process.env.RESEND_API_KEY || "").trim();
	return runtimeKey || RESEND_API_KEY;
}

export async function sendTransactionalEmail(payload: MailPayload): Promise<{ skipped?: boolean; id?: string }> {
	const apiKey = getResendApiKey();
	if (!apiKey || !payload.to || !payload.subject) {
		return { skipped: true };
	}

	const response = await fetch(RESEND_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: payload.from || MAIL_FROM,
			to: [payload.to],
			subject: payload.subject,
			text: payload.text,
			html: payload.html,
			reply_to: payload.replyTo || MAIL_REPLY_TO || undefined,
		}),
	});

	if (!response.ok) {
		const details = await response.text().catch(() => "");
		throw new Error(`Resend request failed (${response.status}): ${details}`);
	}

	const data = (await response.json().catch(() => ({}))) as { id?: string };
	return { id: data.id };
}

export function escapeHtml(value: string): string {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function formatMoney(value: any, currency = "USD"): string {
	const amount = Number(value);
	if (!Number.isFinite(amount)) return "-";
	try {
		return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
	} catch {
		return amount.toFixed(2);
	}
}

export function toAbsoluteImageUrl(imageUrl: string): string {
	const normalized = String(imageUrl || "").trim();
	if (!normalized) return "";
	if (/^https?:\/\//i.test(normalized)) return normalized;
	if (normalized.startsWith("/")) return `${FRONTEND_ORIGIN}${normalized}`;
	return `${FRONTEND_ORIGIN}/${normalized}`;
}

function baseTemplate(title: string, preview: string, bodyHtml: string): string {
	return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f6f7fb;color:#1f2937;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:24px 28px;background:#0f172a;color:#fff;font-size:20px;font-weight:700;">Filspresso</td>
            </tr>
            <tr>
              <td style="padding:28px;line-height:1.6;font-size:15px;">${bodyHtml}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildEmailVerificationHtml(payload: { displayName?: string; verificationUrl?: string }): string {
	const displayName = escapeHtml(payload?.displayName || "there");
	const verificationUrl = escapeHtml(payload?.verificationUrl || `${FRONTEND_ORIGIN}/?page=account`);
	return baseTemplate(
		"Verify your Filspresso email",
		"Verify your email to activate your account.",
		`<h1 style="margin:0 0 14px;font-size:22px;color:#0f172a;">Verify your email</h1>
     <p style="margin:0 0 16px;">Hi ${displayName}, please verify your email address to finish setting up your account.</p>
     <p style="margin:20px 0;">
       <a href="${verificationUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;">Verify Email</a>
     </p>
     <p style="margin:0;color:#6b7280;font-size:13px;">If you did not create this account, you can ignore this email.</p>`,
	);
}

export function buildOrderEmailHtml(payload: {
	displayName?: string;
	orderId?: string;
	total?: any;
	currency?: string;
	status?: string;
}): string {
	const displayName = escapeHtml(payload?.displayName || "there");
	const orderId = escapeHtml(payload?.orderId || "-");
	const total = escapeHtml(formatMoney(payload?.total, payload?.currency || "USD"));
	const status = escapeHtml(payload?.status || "received");
	return baseTemplate(
		"Order update",
		"Your Filspresso order was updated.",
		`<h1 style="margin:0 0 14px;font-size:22px;color:#0f172a;">Order update</h1>
     <p style="margin:0 0 16px;">Hi ${displayName}, your order has been ${status}.</p>
     <p style="margin:0;"><strong>Order:</strong> ${orderId}</p>
     <p style="margin:6px 0 0;"><strong>Total:</strong> ${total}</p>`,
	);
}

export function buildWelcomeHtml(payload: { displayName?: string; accountUrl?: string }): string {
	const displayName = escapeHtml(payload?.displayName || "there");
	const accountUrl = escapeHtml(payload?.accountUrl || `${FRONTEND_ORIGIN}/?page=account`);
	return baseTemplate(
		"Welcome to Filspresso",
		"Your account is ready.",
		`<h1 style="margin:0 0 14px;font-size:22px;color:#0f172a;">Welcome to Filspresso</h1>
     <p style="margin:0 0 16px;">Hi ${displayName}, your account is ready. You can now manage profile settings and preferences.</p>
     <p style="margin:20px 0;">
       <a href="${accountUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;">Open Account</a>
     </p>`,
	);
}

export function buildSecurityLoginHtml(payload: {
	displayName?: string;
	ipAddress?: string;
	userAgent?: string;
	occurredAt?: string;
}): string {
	const displayName = escapeHtml(payload?.displayName || "there");
	const ipAddress = escapeHtml(payload?.ipAddress || "Unknown");
	const userAgent = escapeHtml(payload?.userAgent || "Unknown");
	const occurredAt = escapeHtml(payload?.occurredAt || new Date().toISOString());
	return baseTemplate(
		"Security alert: new login",
		"A new login to your Filspresso account was detected.",
		`<h1 style="margin:0 0 14px;font-size:22px;color:#0f172a;">Security alert</h1>
     <p style="margin:0 0 16px;">Hi ${displayName}, we detected a new login to your account.</p>
     <p style="margin:0;"><strong>Time:</strong> ${occurredAt}</p>
     <p style="margin:6px 0 0;"><strong>IP:</strong> ${ipAddress}</p>
     <p style="margin:6px 0 0;"><strong>Device:</strong> ${userAgent}</p>
     <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">If this wasn't you, change your password immediately.</p>`,
	);
}
