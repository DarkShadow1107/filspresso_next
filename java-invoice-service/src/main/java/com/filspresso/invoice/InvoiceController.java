package com.filspresso.invoice;

import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.Image;
import com.lowagie.text.Chunk;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfContentByte;
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
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import javax.imageio.ImageIO;

@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {

    private static final BigDecimal VAT_RATE = new BigDecimal("0.21");
    private static final Color COFFEE_DARK = new Color(28, 22, 18);
    private static final Color COFFEE_ACCENT = new Color(196, 167, 125);
    private static final Color COFFEE_MID = new Color(143, 106, 73);
    private static final Color COFFEE_SOFT = new Color(232, 217, 198);
    private static final Color ROW_ALT = new Color(248, 244, 239);
    private static final String DEFAULT_LOGO_PATH = "/app/public/images/Logo_filspresso_web.png";
    private static final Path PUBLIC_IMAGES_ROOT = Path.of("/app/public/images");
    private static final Map<String, String> IMAGE_FILE_LOOKUP_CACHE = new ConcurrentHashMap<>();

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
            Document doc = new Document(PageSize.A4, 42, 42, 30, 38);
            PdfWriter writer = PdfWriter.getInstance(doc, output);
            // Keep invoice printable but discourage content edits in common PDF editors.
            writer.setEncryption(null, null, PdfWriter.ALLOW_PRINTING, PdfWriter.ENCRYPTION_AES_128);
            doc.open();

            addHeader(doc, req, writer);
            addCustomerAndMeta(doc, req);
            addItems(doc, req);
            addTotals(doc, req);
            SignatureStampRenderer.addSignatureStamp(doc, req);
            addFooter(doc, req);

            doc.close();
            return output.toByteArray();
        } catch (Exception ex) {
            throw new RuntimeException("Could not build invoice PDF", ex);
        }
    }

    private void addHeader(Document doc, InvoiceRequest req, PdfWriter writer) throws Exception {
        drawTopGradient(writer, doc);

        PdfPTable header = new PdfPTable(new float[]{2.35f, 1.65f});
        header.setWidthPercentage(100);
        header.setSpacingBefore(0);
        header.setSpacingAfter(2);

        PdfPCell brandCell = new PdfPCell();
        brandCell.setPadding(10);
        brandCell.setBorder(Rectangle.NO_BORDER);

        Font title = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 18, COFFEE_SOFT);
        Font sub = FontFactory.getFont(FontFactory.HELVETICA, 9, new Color(235, 228, 218));
        Font legal = FontFactory.getFont(FontFactory.HELVETICA, 7.5f, new Color(200, 190, 180));

        Image logoImage = tryLoadLogo();
        if (logoImage != null) {
            logoImage.scaleToFit(190f, 42f);
            logoImage.setAlignment(Element.ALIGN_LEFT);
            brandCell.addElement(logoImage);
        } else {
            Paragraph brand = new Paragraph("FILSPRESSO", title);
            brand.setSpacingAfter(5);
            brandCell.addElement(brand);
        }

        Paragraph frTagline = new Paragraph("Cafe de specialite, precision livree", sub);
        frTagline.setSpacingBefore(4);
        brandCell.addElement(frTagline);

        PdfPCell invoiceCell = new PdfPCell();
        invoiceCell.setPadding(8);
        invoiceCell.setBorder(Rectangle.NO_BORDER);

        Font invoiceLabel = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 16, Color.BLACK);
        Font invoiceSub = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9.5f, Color.BLACK);

        Paragraph inv = new Paragraph("INVOICE", invoiceLabel);
        inv.setAlignment(Element.ALIGN_RIGHT);
        inv.setSpacingAfter(6);
        invoiceCell.addElement(inv);

        Paragraph orderRef = new Paragraph("Order no: " + req.orderNumber(), invoiceSub);
        orderRef.setAlignment(Element.ALIGN_RIGHT);
        orderRef.setSpacingAfter(0);
        invoiceCell.addElement(orderRef);

        header.addCell(brandCell);
        header.addCell(invoiceCell);

        doc.add(header);
    }

    private void drawTopGradient(PdfWriter writer, Document doc) {
        PdfContentByte canvas = writer.getDirectContentUnder();
        float x = doc.left();
        float y = doc.top() - 85;
        float width = doc.right() - doc.left();
        float height = 98f;
        int steps = 120;

        for (int i = 0; i < steps; i++) {
            float t = i / (float) (steps - 1);
            Color color = t < 0.5f
                    ? blend(COFFEE_DARK, COFFEE_MID, t * 2f)
                    : blend(COFFEE_MID, COFFEE_ACCENT, (t - 0.5f) * 2f);
            canvas.setColorFill(color);
            float sx = x + (width * i / steps);
            float sw = width / steps + 0.8f;
            canvas.rectangle(sx, y, sw, height);
            canvas.fill();
        }
    }

    private Color blend(Color a, Color b, float t) {
        float clamped = Math.max(0f, Math.min(1f, t));
        int r = Math.round(a.getRed() + (b.getRed() - a.getRed()) * clamped);
        int g = Math.round(a.getGreen() + (b.getGreen() - a.getGreen()) * clamped);
        int bl = Math.round(a.getBlue() + (b.getBlue() - a.getBlue()) * clamped);
        return new Color(r, g, bl);
    }

    private void addCustomerAndMeta(Document doc, InvoiceRequest req) throws Exception {
        PdfPTable grid = new PdfPTable(new float[]{1.7f, 1.3f});
        grid.setWidthPercentage(100);
        grid.setSpacingAfter(8);

        PdfPCell customer = new PdfPCell();
        customer.setBorderColor(new Color(220, 220, 220));
        customer.setBackgroundColor(new Color(254, 251, 247));
        customer.setPadding(12);
        customer.addElement(new Paragraph("Bill To", FontFactory.getFont(FontFactory.HELVETICA_BOLD, 11, COFFEE_DARK)));
        customer.addElement(new Paragraph(req.customerName(), FontFactory.getFont(FontFactory.HELVETICA, 10, Color.BLACK)));
        customer.addElement(new Paragraph(req.customerEmail(), FontFactory.getFont(FontFactory.HELVETICA, 10, Color.BLACK)));
        if (!req.billingAddress().isBlank()) {
            customer.addElement(new Paragraph(req.billingAddress(), FontFactory.getFont(FontFactory.HELVETICA, 9, Color.DARK_GRAY)));
        }
        if (!req.shippingAddress().isBlank()) {
            customer.addElement(new Paragraph("Ship to: " + req.shippingAddress(), FontFactory.getFont(FontFactory.HELVETICA, 9, Color.DARK_GRAY)));
        }

        PdfPCell meta = new PdfPCell();
        meta.setBorderColor(new Color(220, 220, 220));
        meta.setBackgroundColor(new Color(250, 246, 240));
        meta.setPadding(12);
        meta.addElement(metaLine("Order date", req.orderDate()));
        meta.addElement(metaLine("Status", req.status().toUpperCase()));
        addPaymentMetaLine(meta, req);

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

    private void addPaymentMetaLine(PdfPCell container, InvoiceRequest req) {
        Font val = FontFactory.getFont(FontFactory.HELVETICA, 9, Color.DARK_GRAY);

        Paragraph line = new Paragraph();

        Image cardLogo = tryLoadPaymentCardLogo(req);
        if (cardLogo != null) {
            cardLogo.scaleToFit(28f, 18f);
            cardLogo.setAlignment(Element.ALIGN_LEFT);
            line.add(new Chunk(cardLogo, 0f, -3f, true));
            line.add(new Phrase("  ", val));
        }

        line.add(new Phrase(paymentMaskedDisplay(req), val));
        line.setSpacingAfter(4);
        container.addElement(line);
    }

    private String paymentMaskedDisplay(InvoiceRequest req) {
        String explicitLastFour = digitsOnly(req.paymentCardLastFour());
        if (!explicitLastFour.isBlank()) {
            return "•••• " + explicitLastFour;
        }

        String summary = req.paymentSummary() == null ? "" : req.paymentSummary().trim();
        if (!summary.isBlank()) {
            String sanitized = summary.replaceAll("\\([A-Za-z]{3}\\)\\s*$", "").trim();
            java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("(\\d{4})$").matcher(sanitized);
            if (matcher.find()) {
                return "•••• " + matcher.group(1);
            }
            if (sanitized.contains("••••")) {
                return "••••";
            }
        }

        return "••••";
    }

    private String digitsOnly(String raw) {
        if (raw == null) return "";
        String digits = raw.replaceAll("[^0-9]", "");
        if (digits.length() > 4) {
            return digits.substring(digits.length() - 4);
        }
        return digits;
    }

    private Image tryLoadPaymentCardLogo(InvoiceRequest req) {
        String directLogo = req.paymentCardLogo();
        if (directLogo != null && !directLogo.isBlank()) {
            Image loaded = tryLoadProductImage(directLogo);
            if (loaded != null) {
                return loaded;
            }
        }

        String normalizedType = normalizeCardTypeLabel(req.paymentCardType()).toLowerCase();
        String mappedLogoPath = switch (normalizedType) {
            case "visa" -> "/images/Payment/Visa.png";
            case "mastercard" -> "/images/Payment/Mastercard.png";
            case "american express" -> "/images/Payment/American_Express.png";
            case "discover" -> "/images/Payment/Discover.png";
            default -> "";
        };

        if (!mappedLogoPath.isBlank()) {
            return tryLoadProductImage(mappedLogoPath);
        }

        return null;
    }

    private String normalizeCardTypeLabel(String cardType) {
        if (cardType == null || cardType.isBlank()) {
            return "";
        }

        String normalized = cardType
                .trim()
                .toLowerCase()
                .replaceAll("[._-]+", " ")
                .replaceAll("\\s+", " ");

        if (normalized.contains("american express") || normalized.equals("amex") || normalized.contains(" amex")) {
            return "American Express";
        }
        if (normalized.contains("master") && normalized.contains("card")) {
            return "Mastercard";
        }
        if (normalized.contains("visa")) {
            return "Visa";
        }
        if (normalized.contains("discover")) {
            return "Discover";
        }

        return normalized;
    }

    private void addItems(Document doc, InvoiceRequest req) throws Exception {
        boolean includeView = req.includeProductView();
        PdfPTable table = includeView
                ? new PdfPTable(new float[]{1.1f, 3.8f, 1.0f, 1.2f, 1.4f})
                : new PdfPTable(new float[]{4.5f, 1.0f, 1.2f, 1.4f});
        table.setWidthPercentage(100);
        table.setSpacingBefore(2);
        table.setSpacingAfter(10);

        if (includeView) {
            addHeaderCell(table, "View");
        }
        addHeaderCell(table, "Product");
        addHeaderCell(table, "Quantity");
        addHeaderCell(table, "Unit (RON)");
        addHeaderCell(table, "Total (RON)");

        int row = 0;
        for (InvoiceItem item : req.items()) {
            Color bg = row % 2 == 0 ? Color.WHITE : ROW_ALT;
            if (includeView) {
                addViewCell(table, item, bg);
            }
            addProductCell(table, item, bg, includeView);
            addBodyCell(table, String.valueOf(item.quantity()), Element.ALIGN_CENTER, bg);
            addBodyCell(table, money(item.unitPrice(), "RON"), Element.ALIGN_RIGHT, bg);
            addBodyCell(table, money(item.totalPrice(), "RON"), Element.ALIGN_RIGHT, bg);
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

    private void addProductCell(PdfPTable table, InvoiceItem item, Color background, boolean includeView) {
        PdfPCell cell = new PdfPCell();
        cell.setVerticalAlignment(Element.ALIGN_MIDDLE);
        cell.setBackgroundColor(background);
        cell.setPadding(8);
        cell.setBorderColor(new Color(230, 230, 230));

        Paragraph name = new Paragraph(cleanProductName(item.name()), FontFactory.getFont(FontFactory.HELVETICA, 9, Color.BLACK));
        name.setAlignment(Element.ALIGN_LEFT);
        cell.addElement(name);

        if (!item.capsuleSystem().isBlank()) {
            String capsuleLabel = item.capsuleSystem().equalsIgnoreCase("vertuo") ? "Vertuo" : "Original";
            Paragraph capsuleLine = new Paragraph(
                    "Capsule system: " + capsuleLabel,
                    FontFactory.getFont(FontFactory.HELVETICA_OBLIQUE, includeView ? 8f : 8.5f, COFFEE_MID)
            );
            capsuleLine.setSpacingBefore(2f);
            capsuleLine.setAlignment(Element.ALIGN_LEFT);
            cell.addElement(capsuleLine);
        }

        table.addCell(cell);
    }

    private void addViewCell(PdfPTable table, InvoiceItem item, Color background) {
        PdfPCell cell = new PdfPCell();
        cell.setVerticalAlignment(Element.ALIGN_MIDDLE);
        cell.setHorizontalAlignment(Element.ALIGN_CENTER);
        cell.setBackgroundColor(background);
        cell.setPadding(8);
        cell.setBorderColor(new Color(230, 230, 230));

        Image productImage = tryLoadProductImage(item.productImage());
        if (productImage != null) {
            productImage.scaleToFit(42f, 42f);
            productImage.setAlignment(Element.ALIGN_CENTER);
            cell.addElement(productImage);
        } else {
            Phrase placeholder = new Phrase("-", FontFactory.getFont(FontFactory.HELVETICA, 10, new Color(130, 130, 130)));
            cell.setPhrase(placeholder);
        }

        table.addCell(cell);
    }

    private String cleanProductName(String raw) {
        if (raw == null || raw.isBlank()) {
            return "Product";
        }
        return raw
                .trim()
                .replaceAll("\\s*-\\s*\\d+(?:[.,]\\d{1,2})?\\s*(?:RON|EUR|USD|CHF|GBP)\\s*$", "")
                .replaceAll("\\s{2,}", " ");
    }

    private void addTotals(Document doc, InvoiceRequest req) throws Exception {
        PdfPTable totals = new PdfPTable(new float[]{2.4f, 1f});
        totals.setHorizontalAlignment(Element.ALIGN_RIGHT);
        totals.setTotalWidth(260);
        totals.setLockedWidth(true);
        totals.setSpacingBefore(4);

        BigDecimal subtotalA = subtotalA(req);
        BigDecimal discountAmount = req.discountAmount().setScale(2, RoundingMode.HALF_UP);
        BigDecimal subtotalB = subtotalB(req);
        BigDecimal exchangeTax = exchangeTaxRon(req);
        BigDecimal totalBeforeVat = totalBeforeVatRon(req);
        BigDecimal vatAmount = vatAmountRon(req);
        BigDecimal chargedTotal = chargedTotal(req);

        addTotalLine(totals, "Subtotal A", money(subtotalA, req.baseCurrencyCode()), false);
        if (discountAmount.compareTo(BigDecimal.ZERO) > 0) {
            addTotalLine(totals, "Discount", "- " + money(discountAmount, req.baseCurrencyCode()), false);
        }
        addTotalLine(totals, "Subtotal B", money(subtotalB, req.baseCurrencyCode()), false);

        if (exchangeTax.compareTo(BigDecimal.ZERO) > 0) {
            addTotalLine(totals, "Exchange tax (" + req.conversionFeePercent().setScale(2, RoundingMode.HALF_UP).toPlainString() + "%)", money(exchangeTax, req.baseCurrencyCode()), false);
        }

        addTotalLine(totals, "Total", money(totalBeforeVat, req.baseCurrencyCode()), false);
        addTotalLine(totals, "VAT (21%)", money(vatAmount, req.baseCurrencyCode()), false);
        addTotalLine(totals, "Charged total", money(chargedTotal, req.currencyCode()), true);

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

    private void addFooter(Document doc, InvoiceRequest req) throws Exception {
        PdfPTable footer = new PdfPTable(new float[]{1f});
        footer.setWidthPercentage(100);
        footer.setSpacingBefore(8);

        PdfPCell footerCell = new PdfPCell();
        footerCell.setBorder(Rectangle.NO_BORDER);
        footerCell.setPaddingTop(3);
        footerCell.setPaddingBottom(0);
        footerCell.setBorderWidthTop(0.6f);
        footerCell.setBorderColorTop(new Color(200, 190, 180));

        Font heading = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 8.5f, COFFEE_DARK);
        Font body = FontFactory.getFont(FontFactory.HELVETICA, 8f, new Color(66, 60, 56));
        Font muted = FontFactory.getFont(FontFactory.HELVETICA, 7.5f, new Color(96, 90, 86));

        Paragraph company = new Paragraph("Filspresso LLC | Bucharest, Romania | support@filspresso.com", heading);
        company.setAlignment(Element.ALIGN_LEFT);
        company.setSpacingAfter(3);
        footerCell.addElement(company);

        Paragraph terms = new Paragraph("Terms and Conditions: https://filspresso.com/terms-and-conditions", body);
        terms.setAlignment(Element.ALIGN_LEFT);
        terms.setSpacingAfter(3);
        footerCell.addElement(terms);

        String rateLine = exchangeRateSummary(req);
        if (rateLine != null) {
            Paragraph exchange = new Paragraph(rateLine, muted);
            exchange.setAlignment(Element.ALIGN_LEFT);
            exchange.setSpacingAfter(2);
            footerCell.addElement(exchange);
        }

        Paragraph note = new Paragraph("Issued electronically by Filspresso Finance for accounting, reconciliation, and payment confirmation.", muted);
        note.setAlignment(Element.ALIGN_LEFT);
        footerCell.addElement(note);

        footer.addCell(footerCell);
        doc.add(footer);
    }

    private BigDecimal subtotalA(InvoiceRequest req) {
        return req.subtotal().setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal subtotalB(InvoiceRequest req) {
        return subtotalA(req).subtract(req.discountAmount().setScale(2, RoundingMode.HALF_UP)).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal exchangeTaxRon(InvoiceRequest req) {
        if ("RON".equalsIgnoreCase(req.currencyCode()) || req.conversionFeePercent().compareTo(BigDecimal.ZERO) <= 0) {
            return BigDecimal.ZERO;
        }
        return subtotalB(req)
                .multiply(req.conversionFeePercent().divide(new BigDecimal("100"), 6, RoundingMode.HALF_UP))
                .setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal vatAmountRon(InvoiceRequest req) {
        BigDecimal vatBase = totalBeforeVatRon(req);
        return vatBase.multiply(VAT_RATE).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal totalBeforeVatRon(InvoiceRequest req) {
        return subtotalB(req).add(exchangeTaxRon(req)).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal chargedTotal(InvoiceRequest req) {
        BigDecimal totalBeforeVat = totalBeforeVatRon(req);
        if ("RON".equalsIgnoreCase(req.currencyCode()) || req.exchangeRate().compareTo(BigDecimal.ONE) == 0) {
            return totalBeforeVat.setScale(2, RoundingMode.HALF_UP);
        }
        return totalBeforeVat.multiply(req.exchangeRate()).setScale(2, RoundingMode.HALF_UP);
    }

    private String exchangeRateSummary(InvoiceRequest req) {
        if ("RON".equalsIgnoreCase(req.currencyCode()) || req.exchangeRate().compareTo(BigDecimal.ONE) == 0) {
            return null;
        }

        BigDecimal forwardRate = req.exchangeRate().setScale(6, RoundingMode.HALF_UP);
        BigDecimal reverseRate = BigDecimal.ONE.divide(req.exchangeRate(), 6, RoundingMode.HALF_UP);
        return String.format(
                "Exchange rate applied from %s to %s: 1 %s = %s %s (1 %s = %s %s).",
                req.baseCurrencyCode(),
                req.currencyCode(),
                req.baseCurrencyCode(),
                forwardRate.toPlainString(),
                req.currencyCode(),
                req.currencyCode(),
                reverseRate.toPlainString(),
                req.baseCurrencyCode()
        );
    }

    private Image tryLoadLogo() {
        String path = System.getenv("INVOICE_LOGO_PATH");
        if (path == null || path.isBlank()) {
            path = DEFAULT_LOGO_PATH;
        }
        try {
            File logoFile = new File(path);
            if (!logoFile.exists() || !logoFile.isFile()) {
                return null;
            }
            return Image.getInstance(logoFile.getAbsolutePath());
        } catch (Exception ignored) {
            return null;
        }
    }

    private Image tryLoadProductImage(String rawPath) {
        if (rawPath == null || rawPath.isBlank()) {
            return null;
        }

        String path = rawPath.trim().replace("\\", "/");
        try {
            if (path.startsWith("http://") || path.startsWith("https://")) {
                try {
                    URI uri = URI.create(path);
                    if (uri.getPath() != null && !uri.getPath().isBlank()) {
                        path = uri.getPath();
                    }
                } catch (Exception ignored) {
                    // Fall through to direct URL fetch.
                }

                if (path.startsWith("http://") || path.startsWith("https://")) {
                    return Image.getInstance(path);
                }
            }

            if (path.startsWith("data:image/")) {
                int marker = path.indexOf(",");
                if (marker > 0) {
                    String meta = path.substring(0, marker).toLowerCase();
                    String payload = path.substring(marker + 1);
                    byte[] imageBytes;
                    if (meta.endsWith(";base64")) {
                        imageBytes = Base64.getDecoder().decode(payload);
                    } else {
                        imageBytes = URLDecoder.decode(payload, StandardCharsets.UTF_8).getBytes(StandardCharsets.ISO_8859_1);
                    }
                    return Image.getInstance(imageBytes);
                }
            }

            if (path.startsWith("/images/")) {
                path = "/app/public" + path;
            } else if (path.startsWith("images/")) {
                path = "/app/public/" + path;
            } else if (path.startsWith("/public/images/")) {
                path = "/app" + path;
            } else if (path.startsWith("public/images/")) {
                path = "/app/" + path;
            } else if (!path.startsWith("/")) {
                path = "/app/public/images/" + path;
            }

            File file = new File(path);
            if (!file.exists() || !file.isFile()) {
                if (path.startsWith("/app/public/images/")) {
                    String fallback = "/app/public/" + path.substring("/app/public/images/".length());
                    File fallbackFile = new File(fallback);
                    if (fallbackFile.exists() && fallbackFile.isFile()) {
                        Image fallbackImage = loadPdfImageFromFile(fallbackFile);
                        if (fallbackImage != null) {
                            return fallbackImage;
                        }
                    }
                }

                String discovered = findImageByFileName(rawPath);
                if (discovered != null) {
                    File discoveredFile = new File(discovered);
                    if (discoveredFile.exists() && discoveredFile.isFile()) {
                        Image discoveredImage = loadPdfImageFromFile(discoveredFile);
                        if (discoveredImage != null) {
                            return discoveredImage;
                        }
                    }
                }
                return null;
            }
            return loadPdfImageFromFile(file);
        } catch (Exception ignored) {
            return null;
        }
    }

    private Image loadPdfImageFromFile(File file) {
        if (file == null || !file.exists() || !file.isFile()) {
            return null;
        }

        try {
            String lowerName = file.getName().toLowerCase();
            if (lowerName.endsWith(".avif")) {
                BufferedImage buffered = ImageIO.read(file);
                if (buffered != null) {
                    return bufferedImageToPdfImage(buffered);
                }
            }
        } catch (Exception ignored) {
            // Fall back to direct OpenPDF file loading below.
        }

        try {
            return Image.getInstance(file.getAbsolutePath());
        } catch (Exception ignored) {
            return null;
        }
    }

    private Image bufferedImageToPdfImage(BufferedImage buffered) throws IOException {
        try (ByteArrayOutputStream pngBuffer = new ByteArrayOutputStream()) {
            ImageIO.write(buffered, "png", pngBuffer);
            return Image.getInstance(pngBuffer.toByteArray());
        } catch (Exception ex) {
            throw new IOException("Failed to convert decoded image for PDF", ex);
        }
    }

    private String findImageByFileName(String rawPath) {
        try {
            String normalized = rawPath == null ? "" : rawPath.trim().replace("\\", "/");
            String candidate = normalized;
            if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
                try {
                    URI uri = URI.create(candidate);
                    candidate = uri.getPath() == null ? candidate : uri.getPath();
                } catch (Exception ignored) {
                    // Keep original candidate.
                }
            }

            int slash = candidate.lastIndexOf('/');
            String fileName = slash >= 0 ? candidate.substring(slash + 1) : candidate;
            if (fileName.isBlank()) {
                return null;
            }

            String decoded = URLDecoder.decode(fileName, StandardCharsets.UTF_8);
            String cacheHit = IMAGE_FILE_LOOKUP_CACHE.get(decoded);
            if (cacheHit != null) {
                return cacheHit;
            }

            if (!Files.exists(PUBLIC_IMAGES_ROOT)) {
                return null;
            }

            try (var stream = Files.walk(PUBLIC_IMAGES_ROOT, 6)) {
                Path match = stream
                        .filter(Files::isRegularFile)
                        .filter(path -> path.getFileName().toString().equalsIgnoreCase(decoded))
                        .findFirst()
                        .orElse(null);

                if (match != null) {
                    String resolved = match.toAbsolutePath().toString();
                    IMAGE_FILE_LOOKUP_CACHE.put(decoded, resolved);
                    return resolved;
                }
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private String money(BigDecimal amount, String currencyCode) {
        return amount.setScale(2, RoundingMode.HALF_UP) + " " + currencyCode;
    }

    public record InvoiceRequest(
            String invoiceNumber,
            String orderNumber,
            String orderDate,
            String generatedAt,
            String status,
            String destinationCountry,
            String customerName,
            String customerEmail,
            String billingAddress,
            String shippingAddress,
            String paymentSummary,
            String paymentCardType,
            String paymentCardLastFour,
            String paymentCardLogo,
            String baseCurrencyCode,
            String currencyCode,
            BigDecimal exchangeRate,
            BigDecimal conversionFeePercent,
            BigDecimal subtotal,
            BigDecimal discountAmount,
            BigDecimal shippingCost,
            BigDecimal tax,
            BigDecimal total,
            BigDecimal chargedSubtotal,
            BigDecimal chargedShippingCost,
            BigDecimal chargedTax,
            BigDecimal chargedTotal,
            Boolean includeProductView,
            List<InvoiceItem> items
    ) {
        InvoiceRequest normalized() {
            List<InvoiceItem> normalizedItems = items == null ? List.of() : items.stream().map(InvoiceItem::normalized).toList();
            String order = safe(orderNumber, "UNKNOWN");
            String date = normalizeDate(orderDate);
            String statusValue = safe(status, "confirmed");
            String invoice = safe(invoiceNumber, "INV-" + order);
            String generated = normalizeDateTime(generatedAt);
            return new InvoiceRequest(
                    invoice,
                    order,
                    date,
                    generated,
                    statusValue,
                    safe(destinationCountry, "Romania"),
                    safe(customerName, "Filspresso Customer"),
                    safe(customerEmail, "-"),
                    safe(billingAddress, ""),
                    safe(shippingAddress, ""),
                    safe(paymentSummary, "Card"),
                    safe(paymentCardType, ""),
                    safe(paymentCardLastFour, ""),
                    safe(paymentCardLogo, ""),
                    safe(baseCurrencyCode, "RON"),
                    safe(currencyCode, "RON"),
                    nonNull(exchangeRate),
                    nonNull(conversionFeePercent),
                    nonNull(subtotal),
                    nonNull(discountAmount),
                    nonNull(shippingCost),
                    nonNull(tax),
                    nonNull(total),
                    nonNull(chargedSubtotal),
                    nonNull(chargedShippingCost),
                    nonNull(chargedTax),
                    nonNull(chargedTotal),
                    includeProductView == null || includeProductView,
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

        private static String normalizeDateTime(String raw) {
            if (raw == null || raw.isBlank()) {
                return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
            }
            try {
                OffsetDateTime parsed = OffsetDateTime.parse(raw);
                return parsed.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss XXX"));
            } catch (Exception ignored) {
                return raw;
            }
        }
    }

    public record InvoiceItem(String name, String sku, String productImage, String capsuleSystem, int quantity, BigDecimal unitPrice, BigDecimal totalPrice) {
        InvoiceItem normalized() {
            String normalizedCapsuleSystem = capsuleSystem == null ? "" : capsuleSystem.trim().toLowerCase();
            if (!normalizedCapsuleSystem.equals("original") && !normalizedCapsuleSystem.equals("vertuo")) {
                normalizedCapsuleSystem = "";
            }
            return new InvoiceItem(
                    name == null || name.isBlank() ? "Item" : name,
                    sku == null || sku.isBlank() ? "-" : sku,
                    productImage == null ? "" : productImage,
                    normalizedCapsuleSystem,
                    Math.max(1, quantity),
                    unitPrice == null ? BigDecimal.ZERO : unitPrice,
                    totalPrice == null ? BigDecimal.ZERO : totalPrice
            );
        }
    }
}
