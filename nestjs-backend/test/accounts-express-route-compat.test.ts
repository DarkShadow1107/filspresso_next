import "./test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { Module, type ExecutionContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { AccountsController } from "../src/accounts/accounts.controller";
import { AccountsService } from "../src/accounts/accounts.service";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";

const calls: Array<{ name: string; id?: number }> = [];
const accountsService = {
	async getAccount(_owner: number, id: number) { calls.push({ name: "getAccount", id }); return { id }; },
	async updateAccount(_owner: number, id: number) { calls.push({ name: "updateAccount", id }); return { id }; },
	async deleteAccount(_owner: number, id: number) { calls.push({ name: "deleteAccount", id }); },
	async updateSubscription(_owner: number, id: number) { calls.push({ name: "updateSubscription", id }); return { subscription: { accountId: id } }; },
	async updatePreferences(owner: number, preferences: unknown) { calls.push({ name: "updatePreferences", id: owner }); return { preferences }; },
	async getPreferences(_owner: number, id: number) { calls.push({ name: "getPreferences", id }); return { id }; },
};

@Module({
	controllers: [AccountsController],
	providers: [{ provide: AccountsService, useValue: accountsService }],
})
class AccountsRouteFixtureModule {}

test("account routes keep numeric IDs and the fixed preferences path unambiguous", async (t) => {
	calls.length = 0;
	Reflect.defineMetadata("design:paramtypes", [AccountsService], AccountsController);
	t.mock.method(JwtAuthGuard.prototype, "canActivate", (context: ExecutionContext) => {
		context.switchToHttp().getRequest().user = { id: 7 };
		return true;
	});
	const app = await NestFactory.create(AccountsRouteFixtureModule, { logger: ["error"] });
	try {
		await app.init();
		await request(app.getHttpServer()).put("/api/accounts/preferences").send({ theme: "dark" }).expect(200, {
			message: "Preferences updated",
			preferences: { theme: "dark" },
		});
		await request(app.getHttpServer()).get("/api/accounts/42").expect(200, { account: { id: 42 } });
		await request(app.getHttpServer()).get("/api/accounts/preferences/42").expect(200, { id: 42 });
		await request(app.getHttpServer()).put("/api/accounts/42/subscription").send({ subscriptionId: 3 }).expect(200);
		await request(app.getHttpServer()).get("/api/accounts/not-a-number").expect(400);
		assert.deepEqual(calls.map(({ name, id }) => [name, id]), [
			["updatePreferences", 7],
			["getAccount", 42],
			["getPreferences", 42],
			["updateSubscription", 42],
		]);
	} finally {
		await app.close();
	}
});
