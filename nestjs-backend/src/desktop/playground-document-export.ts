import { BadRequestException } from "@nestjs/common";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import PptxGenJS from "pptxgenjs";
import { join } from "path";
import { existsSync } from "fs";
import { MAX_DOCUMENT_CONTENT_LENGTH } from "./playground-documents.service";

export const EXPORT_MIME = {
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type ExportFormat = keyof typeof EXPORT_MIME;

/** Basic, bounded text export. Spreadsheet cells are always strings, never formulas. */
export async function exportDocument(name: string, content: string, format: ExportFormat): Promise<Buffer> {
	if (typeof content !== "string" || content.length > MAX_DOCUMENT_CONTENT_LENGTH || typeof name !== "string" || name.length > 120) throw new BadRequestException("Invalid document content.");
	const lines = content.replace(/\r\n?/g, "\n").split("\n");
	if (lines.length > 5000) throw new BadRequestException("Document has too many lines to export.");
	if (format === "docx") return Packer.toBuffer(new Document({ sections: [{ children: lines.map(line => new Paragraph(line)) }] }));
	if (format === "xlsx") {
		const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Document");
		// Tab-separated input produces columns; plain text uses one cell per line.
		for (const line of lines) {
			const cells = line.split("\t");
			if (cells.length > 100 || cells.some(cell => cell.length > 32767)) throw new BadRequestException("Spreadsheet row exceeds export limits.");
			sheet.addRow(cells);
		}
		return Buffer.from(await workbook.xlsx.writeBuffer());
	}
	if (format === "pptx") {
		// Split long paragraphs into short lines; presentation design is intentionally basic.
		const pieces = lines.flatMap(line => line.match(/[\s\S]{1,90}/g) || [""]);
		if (pieces.length > 1200) throw new BadRequestException("Document is too long for a basic presentation export.");
		const pptx = new PptxGenJS(); pptx.layout = "LAYOUT_WIDE";
		for (let i = 0; i < pieces.length; i += 6) {
			const slide = pptx.addSlide();
			slide.addText(name, { x: 0.5, y: 0.3, w: 12.3, h: 0.5, fontSize: 20, bold: true });
			slide.addText(pieces.slice(i, i + 6).join("\n"), { x: 0.5, y: 1, w: 12.3, h: 6, fontSize: 16, breakLine: false });
		}
		return Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as Buffer);
	}
	if (format === "pdf") {
		const pdf = new PDFDocument({ autoFirstPage: true }); const chunks: Buffer[] = [];
		const result = new Promise<Buffer>((resolve, reject) => { pdf.on("data", chunk => chunks.push(chunk)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); });
		const embedded = join(process.cwd(), "assets", "playground-export.ttf");
		const local = join("public", "fonts", "poppins-v24-devanagari_latin_latin-ext-regular.ttf");
		const font = [embedded, join(process.cwd(), local), join(process.cwd(), "..", local)].find(existsSync);
		if (!font) throw new Error("Document export font is unavailable.");
		pdf.font(font).fontSize(16).text(name).moveDown().fontSize(10).text(content);
		pdf.end(); return result;
	}
	throw new BadRequestException("Unsupported document format.");
}
