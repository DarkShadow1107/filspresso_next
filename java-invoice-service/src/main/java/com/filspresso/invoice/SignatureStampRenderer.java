package com.filspresso.invoice;

import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.Image;
import com.lowagie.text.Phrase;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.PdfContentByte;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPCellEvent;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.ColumnText;

import java.awt.Color;
import java.io.InputStream;

final class SignatureStampRenderer {

        private static final Color INK = new Color(36, 31, 74);
    private static final Color INK_DARK = new Color(29, 26, 58);
        private static final String SIGNATURE_RESOURCE = "/signature/filspresso-signature.png";

    private SignatureStampRenderer() {
    }

    static void addSignatureStamp(com.lowagie.text.Document doc, InvoiceController.InvoiceRequest req) throws Exception {
        PdfPTable stamp = new PdfPTable(new float[]{1f});
        stamp.setHorizontalAlignment(Element.ALIGN_RIGHT);
        stamp.setTotalWidth(290);
        stamp.setLockedWidth(true);
        stamp.setSpacingBefore(8);

        PdfPCell cell = new PdfPCell();
        cell.setPadding(0);
        cell.setBorder(Rectangle.NO_BORDER);

        PdfPTable inner = new PdfPTable(new float[]{1f});
        inner.setWidthPercentage(100);

        Font title = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 8.25f, INK_DARK);
        Font note = FontFactory.getFont(FontFactory.HELVETICA, 7.35f, INK_DARK);

        PdfPCell topBand = new PdfPCell(new Phrase("AUTHORIZED SIGNATURE", title));
        topBand.setHorizontalAlignment(Element.ALIGN_CENTER);
        topBand.setBorder(Rectangle.NO_BORDER);
        topBand.setPaddingBottom(1);
        inner.addCell(topBand);

        PdfPCell signatureCell = new PdfPCell();
        signatureCell.setBorder(Rectangle.NO_BORDER);
        signatureCell.setFixedHeight(84f);
        signatureCell.setPadding(0);
        signatureCell.setCellEvent(new SignatureCellEvent(req));
        inner.addCell(signatureCell);

        PdfPCell meta = new PdfPCell(new Phrase("Filspresso Treasury Operations | Approved electronically for settlement", note));
        meta.setHorizontalAlignment(Element.ALIGN_CENTER);
        meta.setBorder(Rectangle.NO_BORDER);
        meta.setPaddingTop(1);
        meta.setPaddingBottom(1);
        inner.addCell(meta);

        PdfPCell release = new PdfPCell(new Phrase("Subject to Filspresso Terms and Conditions and applicable exchange-rate policy at execution.", note));
        release.setHorizontalAlignment(Element.ALIGN_CENTER);
        release.setBorder(Rectangle.NO_BORDER);
        release.setPaddingBottom(1);
        inner.addCell(release);

        cell.addElement(inner);
        stamp.addCell(cell);
        doc.add(stamp);
    }

    private static final class SignatureCellEvent implements PdfPCellEvent {

        private SignatureCellEvent(InvoiceController.InvoiceRequest req) {
            // Signature image is static by design; request metadata is not used here.
        }

        @Override
        public void cellLayout(PdfPCell cell, Rectangle position, PdfContentByte[] canvases) {
            PdfContentByte lineCanvas = canvases[PdfPTable.LINECANVAS];
            lineCanvas.saveState();
            lineCanvas.setLineCap(PdfContentByte.LINE_CAP_ROUND);
            lineCanvas.setLineJoin(PdfContentByte.LINE_JOIN_ROUND);

            float left = position.getLeft() + 12f;
            float right = position.getRight() - 14f;
            float bottom = position.getBottom() + 10f;
            float top = position.getTop() - 6f;

            boolean drawn = drawSignatureImage(lineCanvas, left + 1f, right - 1f, bottom + 2f, top - 2f);
            if (!drawn) {
                drawMissingSignatureNotice(lineCanvas, left, right, bottom, top);
            }

            lineCanvas.restoreState();
        }

        private boolean drawSignatureImage(PdfContentByte canvas, float left, float right, float bottom, float top) {
            try (InputStream in = SignatureStampRenderer.class.getResourceAsStream(SIGNATURE_RESOURCE)) {
                if (in == null) {
                    return false;
                }

                byte[] bytes = in.readAllBytes();
                Image image = Image.getInstance(bytes);

                float targetWidth = right - left;
                float targetHeight = top - bottom;
                float imageRatio = image.getWidth() / image.getHeight();
                float targetRatio = targetWidth / targetHeight;

                float drawWidth;
                float drawHeight;
                if (imageRatio > targetRatio) {
                    drawWidth = targetWidth;
                    drawHeight = targetWidth / imageRatio;
                } else {
                    drawHeight = targetHeight;
                    drawWidth = targetHeight * imageRatio;
                }

                float x = left + (targetWidth - drawWidth) * 0.5f;
                float y = bottom + (targetHeight - drawHeight) * 0.5f;

                image.scaleAbsolute(drawWidth, drawHeight);
                image.setAbsolutePosition(x, y);
                canvas.addImage(image);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        private void drawMetallicPanel(PdfContentByte canvas, float left, float right, float bottom, float top) {
            int bands = 52;
            float h = top - bottom;

            for (int i = 0; i < bands; i++) {
                float t = i / (float) (bands - 1);
                float edge = Math.abs((t * 2f) - 1f);

                int dark = (int) (24 + (1f - edge) * 34);
                int warm = (int) (36 + (1f - edge) * 25);
                int sheen = (int) (14 * Math.sin((t * Math.PI * 4.2f) + 0.5f));

                int r = clamp(dark + sheen);
                int g = clamp(dark + sheen);
                int b = clamp(warm + sheen + 10);

                float y0 = bottom + h * t;
                float y1 = bottom + h * ((i + 1f) / bands);
                canvas.setColorFill(new Color(r, g, b));
                canvas.rectangle(left, y0, right - left, y1 - y0 + 0.2f);
                canvas.fill();
            }

            // warm champagne highlight aligned with app's warm accent language
            canvas.setColorFill(new Color(248, 220, 203, 38));
            canvas.rectangle(left, bottom + h * 0.58f, right - left, h * 0.14f);
            canvas.fill();

            canvas.setLineWidth(0.6f);
            canvas.setColorStroke(new Color(248, 220, 203, 110));
            canvas.rectangle(left, bottom, right - left, top - bottom);
            canvas.stroke();
        }

        private void drawCoffeeBeanCluster(PdfContentByte canvas, float left, float right, float bottom, float top) {
            drawCoffeeBean(canvas, left + 8f, bottom + 9f, 6.8f, 4.4f, 22f);
            drawCoffeeBean(canvas, left + 20f, bottom + 12f, 5.8f, 3.9f, -8f);
            drawCoffeeBean(canvas, right - 12f, top - 11f, 5.9f, 3.9f, -16f);
            drawCoffeeBean(canvas, right - 27f, bottom + 9f, 5.4f, 3.4f, 14f);
            drawCoffeeBean(canvas, right - 38f, top - 14f, 4.8f, 3.2f, 30f);
        }

        private void drawCoffeeBean(PdfContentByte canvas, float cx, float cy, float rx, float ry, float angleDeg) {
            canvas.setColorStroke(new Color(132, 95, 56, 190));
            canvas.setLineWidth(0.82f);

            double a = Math.toRadians(angleDeg);
            float cos = (float) Math.cos(a);
            float sin = (float) Math.sin(a);

            float k = 0.55228475f;
            float ox = rx * k;
            float oy = ry * k;

            Point p0 = rot(cx, cy - ry, cx, cy, cos, sin);
            Point p1 = rot(cx + ox, cy - ry, cx, cy, cos, sin);
            Point p2 = rot(cx + rx, cy - oy, cx, cy, cos, sin);
            Point p3 = rot(cx + rx, cy, cx, cy, cos, sin);
            Point p4 = rot(cx + rx, cy + oy, cx, cy, cos, sin);
            Point p5 = rot(cx + ox, cy + ry, cx, cy, cos, sin);
            Point p6 = rot(cx, cy + ry, cx, cy, cos, sin);
            Point p7 = rot(cx - ox, cy + ry, cx, cy, cos, sin);
            Point p8 = rot(cx - rx, cy + oy, cx, cy, cos, sin);
            Point p9 = rot(cx - rx, cy, cx, cy, cos, sin);
            Point p10 = rot(cx - rx, cy - oy, cx, cy, cos, sin);
            Point p11 = rot(cx - ox, cy - ry, cx, cy, cos, sin);

            canvas.moveTo(p0.x(), p0.y());
            canvas.curveTo(p1.x(), p1.y(), p2.x(), p2.y(), p3.x(), p3.y());
            canvas.curveTo(p4.x(), p4.y(), p5.x(), p5.y(), p6.x(), p6.y());
            canvas.curveTo(p7.x(), p7.y(), p8.x(), p8.y(), p9.x(), p9.y());
            canvas.curveTo(p10.x(), p10.y(), p11.x(), p11.y(), p0.x(), p0.y());
            canvas.stroke();

            // center seam
            canvas.setLineWidth(0.46f);
            Point s0 = rot(cx - rx * 0.1f, cy - ry * 0.78f, cx, cy, cos, sin);
            Point s1 = rot(cx + rx * 0.14f, cy - ry * 0.10f, cx, cy, cos, sin);
            Point s2 = rot(cx - rx * 0.08f, cy + ry * 0.74f, cx, cy, cos, sin);
            canvas.moveTo(s0.x(), s0.y());
            canvas.curveTo(s1.x(), s1.y(), s1.x(), s1.y(), s2.x(), s2.y());
            canvas.stroke();

            // subtle highlight edge
            canvas.setLineWidth(0.35f);
            canvas.setColorStroke(new Color(198, 160, 120, 165));
            Point h0 = rot(cx - rx * 0.55f, cy - ry * 0.36f, cx, cy, cos, sin);
            Point h1 = rot(cx - rx * 0.15f, cy - ry * 0.72f, cx, cy, cos, sin);
            Point h2 = rot(cx + rx * 0.25f, cy - ry * 0.42f, cx, cy, cos, sin);
            canvas.moveTo(h0.x(), h0.y());
            canvas.curveTo(h1.x(), h1.y(), h1.x(), h1.y(), h2.x(), h2.y());
            canvas.stroke();

            canvas.setColorStroke(INK_DARK);
        }

        private void drawMissingSignatureNotice(PdfContentByte canvas, float left, float right, float bottom, float top) {
            try {
                Font missingFont = FontFactory.getFont(FontFactory.HELVETICA, 8.0f, new Color(248, 220, 203));
                Phrase phrase = new Phrase("Signature image not found", missingFont);
                ColumnText.showTextAligned(
                        canvas,
                        Element.ALIGN_CENTER,
                        phrase,
                        (left + right) * 0.5f,
                        (bottom + top) * 0.5f,
                        0
                );
            } catch (Exception ignored) {
                // Fail quietly; invoice generation should continue.
            }
        }

        private Point rot(float x, float y, float cx, float cy, float cos, float sin) {
            float dx = x - cx;
            float dy = y - cy;
            return new Point(cx + (dx * cos - dy * sin), cy + (dx * sin + dy * cos));
        }

        private int clamp(int value) {
            return Math.max(0, Math.min(255, value));
        }
    }

    private record Point(float x, float y) {
    }
}
