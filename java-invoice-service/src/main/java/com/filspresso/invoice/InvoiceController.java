package com.filspresso.invoice;

import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {

    private static final Color COFFEE_DARK = new Color(28, 22, 18);
    private static final Color COFFEE_ACCENT = new Color(196, 167, 125);
    private static final Color ROW_ALT = new Color(248, 244, 239);

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "service", "java-invoice-service");
    }

    @PostMapping(value = "/render", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> renderInvoice(@RequestBody InvoiceRequest request) {
        InvoiceRequest normalized = request.normalized();
        byte[] pdf = buildPdf(normalized);

        String fileName = "invoice-" + normalized.orderNumber().replaceAll("[^a-zA-Z0-9-_]", "") + ".pdf";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(fileName, StandardCharsets.UTF_8).build());

        return ResponseEntity.ok().headers(headers).body(pdf);
    }

    private byte[] buildPdf(InvoiceRequest req) {
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Document doc = new Document(PageSize.A4, 42, 42, 42, 42);
            PdfWriter.getInstance(doc, output);
            doc.open();

            addHeader(doc, req);
            addCustomerAndMeta(doc, req);
            addItems(doc, req);
            addTotals(doc, req);
            addFooter(doc);

            doc.close();
            return output.toByteArray();
        } catch (Exception ex) {
            throw new RuntimeException("Could not build invoice PDF", ex);
        }
    }

    private void addHeader(Document doc, InvoiceRequest req) throws Exception {
        PdfPTable header = new PdfPTable(new float[]{2.6f, 1.4f});
        header.setWidthPercentage(100);

        PdfPCell brandCell = new PdfPCell();
        brandCell.setBackgroundColor(COFFEE_DARK);
        brandCell.setPadding(16);
        brandCell.setBorder(Rectangle.NO_BORDER);

        Font title = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 22, COFFEE_ACCENT);
        Font sub = FontFactory.getFont(FontFactory.HELVETICA, 11, new Color(235, 228, 218));

        Paragraph brand = new Paragraph("FILSPRESSO", title);
        brand.setSpacingAfter(5);
        brandCell.addElement(brand);
        brandCell.addElement(new Paragraph("Specialty coffee, precision delivered", sub));

        PdfPCell invoiceCell = new PdfPCell();
        invoiceCell.setBackgroundColor(COFFEE_ACCENT);
        invoiceCell.setPadding(16);
        invoiceCell.setBorder(Rectangle.NO_BORDER);

        Font invoiceLabel = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 16, COFFEE_DARK);
        Font invoiceSub = FontFactory.getFont(FontFactory.HELVETICA, 10, COFFEE_DARK);

        Paragraph inv = new Paragraph("INVOICE", invoiceLabel);
        inv.setAlignment(Element.ALIGN_RIGHT);
        invoiceCell.addElement(inv);
        Paragraph number = new Paragraph("Order " + req.orderNumber(), invoiceSub);
        number.setAlignment(Element.ALIGN_RIGHT);
        invoiceCell.addElement(number);

        header.addCell(brandCell);
        header.addCell(invoiceCell);

        doc.add(header);
        doc.add(new Paragraph(" "));
    }

    private void addCustomerAndMeta(Document doc, InvoiceRequest req) throws Exception {
        PdfPTable grid = new PdfPTable(new float[]{1.7f, 1.3f});
        grid.setWidthPercentage(100);
        grid.setSpacingAfter(12);

        PdfPCell customer = new PdfPCell();
        customer.setBorderColor(new Color(220, 220, 220));
        customer.setPadding(12);
        customer.addElement(new Paragraph("Bill To", FontFactory.getFont(FontFactory.HELVETICA_BOLD, 11, COFFEE_DARK)));
        customer.addElement(new Paragraph(req.customerName(), FontFactory.getFont(FontFactory.HELVETICA, 10, Color.BLACK)));
        customer.addElement(new Paragraph(req.customerEmail(), FontFactory.getFont(FontFactory.HELVETICA, 10, Color.BLACK)));
        if (!req.billingAddress().isBlank()) {
            customer.addElement(new Paragraph(req.billingAddress(), FontFactory.getFont(FontFactory.HELVETICA, 9, Color.DARK_GRAY)));
        }

        PdfPCell meta = new PdfPCell();
        meta.setBorderColor(new Color(220, 220, 220));
        meta.setPadding(12);
        meta.addElement(metaLine("Invoice #", req.invoiceNumber()));
        meta.addElement(metaLine("Date", req.orderDate()));
        meta.addElement(metaLine("Status", req.status().toUpperCase()));
        meta.addElement(metaLine("Payment", req.paymentSummary()));

        grid.addCell(customer);
        grid.addCell(meta);

        doc.add(grid);
    }

    private Paragraph metaLine(String left, String right) {
        Font key = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9, COFFEE_DARK);
        Font val = FontFactory.getFont(FontFactory.HELVETICA, 9, Color.DARK_GRAY);
        Paragraph line = new Paragraph();
        line.add(new Phrase(left + ": ", key));
        line.add(new Phrase(right, val));
        line.setSpacingAfter(4);
        return line;
    }

    private void addItems(Document doc, InvoiceRequest req) throws Exception {
        PdfPTable table = new PdfPTable(new float[]{3.1f, 1.3f, 0.9f, 1.2f, 1.3f});
        table.setWidthPercentage(100);
        table.setSpacingBefore(2);
        table.setSpacingAfter(10);

        addHeaderCell(table, "Item");
        addHeaderCell(table, "SKU");
        addHeaderCell(table, "Qty");
        addHeaderCell(table, "Unit");
        addHeaderCell(table, "Amount");

        int row = 0;
        for (InvoiceItem item : req.items()) {
            Color bg = row % 2 == 0 ? Color.WHITE : ROW_ALT;
            addBodyCell(table, item.name(), Element.ALIGN_LEFT, bg);
            addBodyCell(table, item.sku(), Element.ALIGN_LEFT, bg);
            addBodyCell(table, String.valueOf(item.quantity()), Element.ALIGN_CENTER, bg);
            addBodyCell(table, money(item.unitPrice(), req.currencyCode()), Element.ALIGN_RIGHT, bg);
            addBodyCell(table, money(item.totalPrice(), req.currencyCode()), Element.ALIGN_RIGHT, bg);
            row++;
        }

        doc.add(table);
    }

    private void addHeaderCell(PdfPTable table, String text) {
        PdfPCell cell = new PdfPCell(new Phrase(text, FontFactory.getFont(FontFactory.HELVETICA_BOLD, 10, Color.WHITE)));
        cell.setHorizontalAlignment(Element.ALIGN_CENTER);
        cell.setVerticalAlignment(Element.ALIGN_MIDDLE);
        cell.setBackgroundColor(COFFEE_DARK);
        cell.setPadding(8);
        cell.setBorder(Rectangle.NO_BORDER);
        table.addCell(cell);
    }

    private void addBodyCell(PdfPTable table, String text, int alignment, Color background) {
        PdfPCell cell = new PdfPCell(new Phrase(text, FontFactory.getFont(FontFactory.HELVETICA, 9, Color.BLACK)));
        cell.setHorizontalAlignment(alignment);
        cell.setVerticalAlignment(Element.ALIGN_MIDDLE);
        cell.setBackgroundColor(background);
        cell.setPadding(8);
        cell.setBorderColor(new Color(230, 230, 230));
        table.addCell(cell);
    }

    private void addTotals(Document doc, InvoiceRequest req) throws Exception {
        PdfPTable totals = new PdfPTable(new float[]{2.4f, 1f});
        totals.setHorizontalAlignment(Element.ALIGN_RIGHT);
        totals.setTotalWidth(220);
        totals.setLockedWidth(true);

        addTotalLine(totals, "Subtotal", money(req.subtotal(), req.currencyCode()), false);
        if (req.discountAmount().compareTo(BigDecimal.ZERO) > 0) {
            addTotalLine(totals, "Discount", "- " + money(req.discountAmount(), req.currencyCode()), false);
        }
        addTotalLine(totals, "Shipping", money(req.shippingCost(), req.currencyCode()), false);
        addTotalLine(totals, "Tax", money(req.tax(), req.currencyCode()), false);
        addTotalLine(totals, "Total", money(req.total(), req.currencyCode()), true);

        doc.add(totals);
    }

    private void addTotalLine(PdfPTable table, String label, String value, boolean finalLine) {
        Font labelFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, finalLine ? 11 : 9, finalLine ? COFFEE_DARK : Color.DARK_GRAY);
        Font valueFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, finalLine ? 12 : 9, finalLine ? COFFEE_DARK : Color.BLACK);

        PdfPCell left = new PdfPCell(new Phrase(label, labelFont));
        left.setBorder(Rectangle.NO_BORDER);
        left.setHorizontalAlignment(Element.ALIGN_RIGHT);
        left.setPadding(4);
        table.addCell(left);

        PdfPCell right = new PdfPCell(new Phrase(value, valueFont));
        right.setBorder(Rectangle.NO_BORDER);
        right.setHorizontalAlignment(Element.ALIGN_RIGHT);
        right.setPadding(4);
        table.addCell(right);
    }

    private void addFooter(Document doc) throws Exception {
        Paragraph gap = new Paragraph(" ");
        gap.setSpacingBefore(12);
        doc.add(gap);

        Paragraph footer = new Paragraph(
                "Thank you for choosing Filspresso. For invoice support, contact support@filspresso.com",
                FontFactory.getFont(FontFactory.HELVETICA_OBLIQUE, 9, new Color(92, 84, 78))
        );
        footer.setAlignment(Element.ALIGN_CENTER);
        doc.add(footer);
    }

    private String money(BigDecimal amount, String currencyCode) {
        return amount.setScale(2, RoundingMode.HALF_UP) + " " + currencyCode;
    }

    public record InvoiceRequest(
            String invoiceNumber,
            String orderNumber,
            String orderDate,
            String status,
            String customerName,
            String customerEmail,
            String billingAddress,
            String shippingAddress,
            String paymentSummary,
            String currencyCode,
            BigDecimal subtotal,
            BigDecimal discountAmount,
            BigDecimal shippingCost,
            BigDecimal tax,
            BigDecimal total,
            List<InvoiceItem> items
    ) {
        InvoiceRequest normalized() {
            List<InvoiceItem> normalizedItems = items == null ? List.of() : items.stream().map(InvoiceItem::normalized).toList();
            String order = safe(orderNumber, "UNKNOWN");
            String date = normalizeDate(orderDate);
            String statusValue = safe(status, "confirmed");
            String invoice = safe(invoiceNumber, "INV-" + order);
            return new InvoiceRequest(
                    invoice,
                    order,
                    date,
                    statusValue,
                    safe(customerName, "Filspresso Customer"),
                    safe(customerEmail, "-"),
                    safe(billingAddress, ""),
                    safe(shippingAddress, ""),
                    safe(paymentSummary, "Card"),
                    safe(currencyCode, "RON"),
                    nonNull(subtotal),
                    nonNull(discountAmount),
                    nonNull(shippingCost),
                    nonNull(tax),
                    nonNull(total),
                    normalizedItems
            );
        }

        private static BigDecimal nonNull(BigDecimal value) {
            return value == null ? BigDecimal.ZERO : value;
        }

        private static String safe(String value, String fallback) {
            if (value == null) return fallback;
            String trimmed = value.trim();
            return trimmed.isEmpty() ? fallback : trimmed;
        }

        private static String normalizeDate(String raw) {
            if (raw == null || raw.isBlank()) {
                return LocalDate.now().format(DateTimeFormatter.ISO_DATE);
            }
            try {
                return OffsetDateTime.parse(raw).toLocalDate().format(DateTimeFormatter.ISO_DATE);
            } catch (Exception ignored) {
                return raw.length() > 10 ? raw.substring(0, 10) : raw;
            }
        }
    }

    public record InvoiceItem(String name, String sku, int quantity, BigDecimal unitPrice, BigDecimal totalPrice) {
        InvoiceItem normalized() {
            return new InvoiceItem(
                    name == null || name.isBlank() ? "Item" : name,
                    sku == null || sku.isBlank() ? "-" : sku,
                    Math.max(1, quantity),
                    unitPrice == null ? BigDecimal.ZERO : unitPrice,
                    totalPrice == null ? BigDecimal.ZERO : totalPrice
            );
        }
    }
}
