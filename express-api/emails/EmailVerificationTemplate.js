const React = require("react");
const { Text, Link, Button } = require("@react-email/components");
const { BaseLayout } = require("./BaseLayout");

function EmailVerificationTemplate({ displayName, verificationUrl }) {
	const safeName = displayName || "there";
	return React.createElement(
		BaseLayout,
		{
			previewText: "Verify your Filspresso account",
			title: "Verify your Filspresso email",
			intro: "One click keeps your account secure.",
		},
		React.createElement(Text, null, `Hello ${safeName},`),
		React.createElement(
			Text,
			null,
			"Welcome to Filspresso. Please verify your email address to secure your account and enable transactional updates.",
		),
		React.createElement(Button, { href: verificationUrl, style: styles.button }, "Verify Email Address"),
		React.createElement(
			Text,
			{ style: styles.muted },
			"If the button does not work, copy and paste this link in your browser:",
		),
		React.createElement(Link, { href: verificationUrl, style: styles.link }, verificationUrl),
	);
}

const styles = {
	button: {
		backgroundColor: "#d97706",
		borderRadius: "8px",
		color: "#ffffff",
		fontWeight: "600",
		padding: "12px 16px",
		textDecoration: "none",
		display: "inline-block",
		margin: "10px 0",
	},
	muted: {
		color: "#6b7280",
		fontSize: "13px",
	},
	link: {
		wordBreak: "break-all",
	},
};

module.exports = { EmailVerificationTemplate };
