import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { NotFoundException } from "@nestjs/common";
import { exportDocument, EXPORT_MIME } from "../src/desktop/playground-document-export";
import { PlaygroundDocumentsController } from "../src/desktop/playground-documents.controller";
import type { PlaygroundDocumentsService } from "../src/desktop/playground-documents.service";

test("exports real bounded PDF and Office files", async () => {
	for (const format of ["pdf", "docx", "pptx", "xlsx"] as const) {
		const data = await exportDocument("Notes", "First line\nSecond line", format);
		assert.ok(data.length > 100);
		assert.equal(data.subarray(0, format === "pdf" ? 4 : 2).toString(), format === "pdf" ? "%PDF" : "PK");
		assert.ok(EXPORT_MIME[format]);
	}
	await assert.rejects(exportDocument("x", "x".repeat(200001), "pdf"));
	await assert.rejects(exportDocument("x", "x\n".repeat(5001), "docx"));
});

test("spreadsheet data is stored as strings, including formula-looking text", async () => {
	const data = await exportDocument("x", "=1+1\t+SUM(A1)\n@cmd\t-1", "xlsx");
	const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data as never);
	assert.equal(workbook.worksheets[0].getCell("A1").value, "=1+1");
	assert.equal(workbook.worksheets[0].getCell("B1").value, "+SUM(A1)");
	assert.equal(workbook.worksheets[0].getCell("A2").value, "@cmd");
});

test("export looks up the document under the authenticated account and rejects unsupported formats", async () => {
	const seen: unknown[] = [];
	const documents = { get: async (account: number, id: string) => { seen.push([account, id]); throw new NotFoundException(); } } as unknown as PlaygroundDocumentsService;
	const controller = new PlaygroundDocumentsController(documents);
	const id = "00000000-0000-4000-8000-000000000042";
	await assert.rejects(controller.export({ user: { id: 7 } }, id, "pdf", {} as never), NotFoundException);
	assert.deepEqual(seen, [[7, id]]);
	await assert.rejects(controller.export({ user: { id: 7 } }, id, "exe", {} as never));
	assert.equal(seen.length, 1);
});
