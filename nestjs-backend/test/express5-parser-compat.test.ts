import "./test-env";
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import express, { json, urlencoded } from "express";
import request from "supertest";

test("Express 5 keeps bounded JSON, compressed JSON, nested forms and flat query behavior", async () => {
	const app = express();
	app.use(json({ limit: "128b", strict: true }));
	app.use(urlencoded({ extended: true, limit: "128b" }));
	app.post("/echo", (req, res) => res.json(req.body));
	app.get("/query", (req, res) => res.json({ sortOrder: req.query.sortOrder, repeated: req.query.repeated }));
	app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		res.status(error.status ?? 500).json({ error: "request rejected" });
	});
	const server = app.listen(0);
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	try {
		await request(server).post("/echo").send({ message: "small payload" }).expect(200, { message: "small payload" });
		const compressedResponse = await new Promise<{ status: number; body: string }>((resolve, reject) => {
			const payload = gzipSync(Buffer.from(JSON.stringify({ message: "compressed" })));
			const outbound = http.request({
				host: "127.0.0.1",
				port: address.port,
				path: "/echo",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Encoding": "gzip",
					"Content-Length": payload.length,
				},
			}, (response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
				response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
			});
			outbound.on("error", reject);
			outbound.end(payload);
		});
		assert.equal(compressedResponse.status, 200);
		assert.deepEqual(JSON.parse(compressedResponse.body), { message: "compressed" });
		await request(server)
			.post("/echo")
			.type("form")
			.send("filter%5Bstatus%5D=active&sortOrder=desc")
			.expect(200, { filter: { status: "active" }, sortOrder: "desc" });
		await request(server).get("/query?sortOrder=desc&repeated=one&repeated=two").expect(200, {
			sortOrder: "desc",
			repeated: ["one", "two"],
		});
		await request(server).post("/echo").send({ body: "x".repeat(256) }).expect(413, { error: "request rejected" });
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
});
