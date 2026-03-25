const React = require("react");
const { Text } = require("@react-email/components");
const { BaseLayout } = require("./BaseLayout");

function SecurityLoginTemplate({ displayName, ipAddress, userAgent, occurredAt }) {
	const safeName = displayName || "there";
	const prettyDate = occurredAt ? new Date(occurredAt).toLocaleString("en-US") : new Date().toLocaleString("en-US");

	return React.createElement(
		BaseLayout,
		{
			previewText: "New login detected on your Filspresso account",
			title: "Security login notification",
			intro: "A new sign-in was detected for your account.",
		},
		React.createElement(Text, null, `Hello ${safeName},`),
		React.createElement(
			Text,
			null,
			"A successful sign-in was detected on your Filspresso account. If this was you, no action is needed.",
		),
		React.createElement(Text, null, `Time: ${prettyDate}`),
		React.createElement(Text, null, `IP address: ${ipAddress || "Unavailable"}`),
		React.createElement(Text, null, `Device: ${userAgent || "Unavailable"}`),
		React.createElement(
			Text,
			{ style: { color: "#6b7280", fontSize: "13px" } },
			"If this was not you, reset your password and review your account security settings immediately.",
		),
	);
}

module.exports = { SecurityLoginTemplate };
