import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { DatabaseService } from "../src/database/database.service";
import type { SessionStoreService } from "../src/common/guards/session-store.service";
import { AuthComplexService } from "../src/auth/auth-complex.service";
import { generateToken } from "../src/common/utils/auth-tokens";
import { SESSION_COOKIE_NAME } from "../src/common/utils/session-cookie";

test("web refresh accepts the HTTP-only cookie, rotates the session and invalidates the old cache", async () => {
	const user = { id: 42, username: "fixture", email: "fixture@example.test", name: "Fixture", role: "user", subscription: "free" };
	const token = generateToken(user);
	const queries: string[] = []; const invalidated: string[] = [];
	const client = { query: async (sql: string) => { queries.push(sql); return sql.startsWith("SELECT a.id") ? { rows: [user], rowCount: 1 } : { rows: [], rowCount: 1 }; }, release() {} };
	const db = { getPool: () => ({ connect: async () => client }) } as unknown as DatabaseService;
	const sessions = { invalidate: async (value: string) => { invalidated.push(value); } } as unknown as SessionStoreService;
	const service = new AuthComplexService(db, sessions);
	const req = { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` }, get: () => "", ip: "127.0.0.1", socket: {} } as unknown as Request;
	const result = await service.refresh(req, {} as Response);
	assert.equal(result.status, "success"); assert.notEqual(result.token, token);
	assert.deepEqual(invalidated, [token]);
	assert.ok(queries.some(sql => sql.startsWith("UPDATE user_sessions")));
});

test("web refresh still rejects missing or expired authentication", async () => {
	const service = new AuthComplexService({} as DatabaseService, {} as SessionStoreService);
	await assert.rejects(service.refresh({ headers: {} } as Request, {} as Response));
	await assert.rejects(service.refresh({ headers: { cookie: `${SESSION_COOKIE_NAME}=invalid` } } as Request, {} as Response));
});

test("a failed rotation never invalidates another live session", async () => {
	const user = { id: 42, username: "fixture", email: "fixture@example.test", name: "Fixture", role: "user", subscription: "free" };
	const token = generateToken(user); let invalidated = false;
	const client = { query: async (sql: string) => sql.startsWith("SELECT a.id") ? { rows: [user], rowCount: 1 } : { rows: [], rowCount: 0 }, release() {} };
	const db = { getPool: () => ({ connect: async () => client }) } as unknown as DatabaseService;
	const sessions = { invalidate: async () => { invalidated = true; } } as unknown as SessionStoreService;
	const req = { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` }, get: () => "", ip: "127.0.0.1", socket: {} } as unknown as Request;
	await assert.rejects(new AuthComplexService(db, sessions).refresh(req, {} as Response));
	assert.equal(invalidated, false);
});
