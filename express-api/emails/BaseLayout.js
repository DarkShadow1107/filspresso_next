const React = require("react");
const { Html, Head, Preview, Body, Container, Section, Heading, Text } = require("@react-email/components");

function BaseLayout({ previewText, title, intro, children }) {
	return React.createElement(
		Html,
		null,
		React.createElement(Head, null),
		React.createElement(Preview, null, previewText || intro || title),
		React.createElement(
			Body,
			{ style: styles.body },
			React.createElement(
				Container,
				{ style: styles.container },
				React.createElement(
					Section,
					{ style: styles.header },
					React.createElement(Heading, { as: "h2", style: styles.title }, title),
					React.createElement(Text, { style: styles.intro }, intro),
				),
				React.createElement(Section, { style: styles.content }, children),
			),
		),
	);
}

const styles = {
	body: {
		backgroundColor: "#f5f7fb",
		fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
		margin: 0,
		padding: "24px 8px",
		color: "#1b1f23",
	},
	container: {
		maxWidth: "760px",
		backgroundColor: "#ffffff",
		borderRadius: "14px",
		border: "1px solid #e6e9ef",
		overflow: "hidden",
	},
	header: {
		padding: "20px 24px",
		background: "linear-gradient(120deg, #fff4e6, #fdebd0)",
		borderBottom: "1px solid #f2d7b3",
	},
	title: {
		margin: "0",
		fontSize: "24px",
		color: "#5d3b00",
	},
	intro: {
		margin: "8px 0 0",
		color: "#6a4a14",
		fontSize: "14px",
	},
	content: {
		padding: "20px 24px",
	},
};

module.exports = { BaseLayout };
