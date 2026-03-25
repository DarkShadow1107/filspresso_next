const React = require("react");
const { Section, Text, Row, Column, Img, Hr } = require("@react-email/components");
const { BaseLayout } = require("./BaseLayout");

function money(value, currencyCode) {
	const amount = Number(value || 0);
	return `${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"} ${currencyCode || "RON"}`;
}

function ItemHeader() {
	return React.createElement(
		Row,
		{ style: styles.tableHeader },
		React.createElement(Column, { style: { ...styles.colImage, ...styles.headerCell } }, "Image"),
		React.createElement(Column, { style: { ...styles.colProduct, ...styles.headerCell } }, "Product"),
		React.createElement(Column, { style: { ...styles.colQty, ...styles.headerCellRight } }, "Qty"),
		React.createElement(Column, { style: { ...styles.colUnit, ...styles.headerCellRight } }, "Unit"),
		React.createElement(Column, { style: { ...styles.colTotal, ...styles.headerCellRight } }, "Line Total"),
	);
}

function ItemRow({ item, currencyCode }) {
	const productName = item.productName || item.product_name || "Product";
	const productId = item.productId || item.product_id || "";
	const qty = Number(item.quantity || 1);
	const unitPrice = item.unitPrice || item.unit_price;
	const totalPrice = item.totalPrice || item.total_price;
	const imageUrl = item.productImage || item.product_image || "";

	return React.createElement(
		Row,
		{ style: styles.tableRow },
		React.createElement(
			Column,
			{ style: styles.colImage },
			imageUrl
				? React.createElement(Img, {
						src: imageUrl,
						alt: productName,
						width: "72",
						height: "72",
						style: styles.image,
					})
				: React.createElement(Section, { style: styles.imagePlaceholder }),
		),
		React.createElement(
			Column,
			{ style: styles.colProduct },
			React.createElement(Text, { style: styles.productName }, productName),
			React.createElement(Text, { style: styles.productSku }, productId),
		),
		React.createElement(
			Column,
			{ style: styles.colQty },
			React.createElement(Text, { style: styles.cellRight }, String(qty)),
		),
		React.createElement(
			Column,
			{ style: styles.colUnit },
			React.createElement(Text, { style: styles.cellRight }, money(unitPrice, currencyCode)),
		),
		React.createElement(
			Column,
			{ style: styles.colTotal },
			React.createElement(Text, { style: { ...styles.cellRight, fontWeight: 700 } }, money(totalPrice, currencyCode)),
		),
	);
}

function Totals({ subtotal, discountAmount, shippingCost, tax, total, currencyCode }) {
	const rows = [
		["Subtotal", money(subtotal, currencyCode)],
		["Discount", money(discountAmount, currencyCode)],
		["Shipping", money(shippingCost, currencyCode)],
		["Tax", money(tax, currencyCode)],
		["Total", money(total, currencyCode)],
	];

	return React.createElement(
		Section,
		{ style: styles.totalBox },
		...rows.map(([label, value], index) =>
			React.createElement(
				Row,
				{ key: `${label}-${index}` },
				React.createElement(Column, null, React.createElement(Text, { style: styles.totalLabel }, label)),
				React.createElement(
					Column,
					null,
					React.createElement(
						Text,
						{ style: index === rows.length - 1 ? styles.totalValueStrong : styles.totalValue },
						value,
					),
				),
			),
		),
	);
}

function OrderUpdateTemplate(props) {
	const {
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
	} = props;

	const list = Array.isArray(items) ? items : [];

	return React.createElement(
		BaseLayout,
		{
			previewText: `Order ${orderNumber || ""} update`,
			title,
			intro,
		},
		React.createElement(
			Section,
			{ style: styles.summary },
			React.createElement(Text, { style: styles.summaryLine }, `Order: ${orderNumber || "-"}`),
			React.createElement(Text, { style: styles.summaryLine }, `Status: ${status || "pending"}`),
			React.createElement(Text, { style: styles.summaryLine }, `Date: ${orderDate || new Date().toISOString()}`),
			React.createElement(Text, { style: styles.summaryLine }, `Ship to: ${shippingAddress || "-"}`),
		),
		React.createElement(ItemHeader, null),
		...list.map((item, index) => React.createElement(ItemRow, { key: `${item.productId || index}`, item, currencyCode })),
		React.createElement(Hr, { style: styles.hr }),
		React.createElement(Totals, { subtotal, discountAmount, shippingCost, tax, total, currencyCode }),
		extraNote ? React.createElement(Text, { style: styles.note }, extraNote) : null,
	);
}

const styles = {
	summary: {
		marginBottom: "10px",
	},
	summaryLine: {
		margin: "0 0 6px",
		fontSize: "14px",
	},
	tableHeader: {
		backgroundColor: "#f8fafc",
		border: "1px solid #edf0f4",
		padding: "8px",
	},
	tableRow: {
		borderLeft: "1px solid #edf0f4",
		borderRight: "1px solid #edf0f4",
		borderBottom: "1px solid #edf0f4",
		padding: "8px",
	},
	headerCell: {
		fontSize: "12px",
		fontWeight: "600",
		color: "#6b7280",
		margin: 0,
	},
	headerCellRight: {
		fontSize: "12px",
		fontWeight: "600",
		color: "#6b7280",
		textAlign: "right",
		margin: 0,
	},
	colImage: { width: "96px", padding: "6px" },
	colProduct: { width: "44%", padding: "6px" },
	colQty: { width: "10%", padding: "6px" },
	colUnit: { width: "18%", padding: "6px" },
	colTotal: { width: "20%", padding: "6px" },
	image: {
		display: "block",
		width: "72px",
		height: "72px",
		objectFit: "cover",
		borderRadius: "8px",
		border: "1px solid #e5e7eb",
	},
	imagePlaceholder: {
		width: "72px",
		height: "72px",
		border: "1px solid #e5e7eb",
		borderRadius: "8px",
		backgroundColor: "#f8fafc",
	},
	productName: {
		margin: "0",
		fontSize: "14px",
		fontWeight: "600",
	},
	productSku: {
		margin: "4px 0 0",
		fontSize: "12px",
		color: "#6b7280",
	},
	cellRight: {
		margin: "0",
		fontSize: "13px",
		textAlign: "right",
	},
	hr: {
		margin: "14px 0",
		borderColor: "#e5e7eb",
	},
	totalBox: {
		maxWidth: "320px",
		marginLeft: "auto",
	},
	totalLabel: {
		margin: "0 0 6px",
		fontSize: "13px",
	},
	totalValue: {
		margin: "0 0 6px",
		fontSize: "13px",
		textAlign: "right",
	},
	totalValueStrong: {
		margin: "0 0 6px",
		fontSize: "14px",
		textAlign: "right",
		fontWeight: "700",
	},
	note: {
		marginTop: "16px",
		color: "#6b7280",
		fontSize: "13px",
	},
};

module.exports = { OrderUpdateTemplate };
