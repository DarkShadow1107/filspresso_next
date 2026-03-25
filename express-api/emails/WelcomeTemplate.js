const React = require("react");
const { Text, Link } = require("@react-email/components");
const { BaseLayout } = require("./BaseLayout");

function WelcomeTemplate({ displayName, accountUrl }) {
	const safeName = displayName || "there";
	return React.createElement(
		BaseLayout,
		{
			previewText: "Welcome to Filspresso",
			title: "Welcome to Filspresso",
			intro: "Your account is ready. Coffee updates and order notifications are now enabled.",
		},
		React.createElement(Text, null, `Hello ${safeName},`),
		React.createElement(
			Text,
			null,
			"Thanks for creating your Filspresso account. You can now manage profile settings, payment methods, and order updates from your account dashboard.",
		),
		React.createElement(Text, null, React.createElement(Link, { href: accountUrl }, "Open your Filspresso account")),
	);
}

module.exports = { WelcomeTemplate };
