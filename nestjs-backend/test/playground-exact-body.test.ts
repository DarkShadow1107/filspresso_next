import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { Controller, Post, Body, Module, ValidationPipe, type ExecutionContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { TrimStringsPipe } from "../src/common/pipes/trim-strings.pipe";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";
import { PlaygroundAgentController } from "../src/desktop/playground-agent.controller";
import { PlaygroundAgentActionsController } from "../src/desktop/playground-agent-actions.controller";
import { PlaygroundAgentActionsService } from "../src/desktop/playground-agent-actions.service";
import { PlaygroundSandboxController } from "../src/desktop/playground-sandbox.controller";
import { PlaygroundSandboxService } from "../src/desktop/playground-sandbox.service";
import { DesktopGatewayService } from "../src/desktop/desktop-gateway.service";
import { BillingService } from "../src/billing/billing.service";

@Controller("ordinary-trim-fixture")
class OrdinaryController { @Post() echo(@Body() body: unknown) { return body; } }

test("mounted Nest pipes preserve exact agent/action/source bodies while ordinary routes still trim", async t => {
	// tsx does not emit design:paramtypes; the production tsc build does. Supply only the
	// fixture's injection metadata so this test mounts real controllers, not manual handlers.
	Reflect.defineMetadata("design:paramtypes", [BillingService, DesktopGatewayService], PlaygroundAgentController);
	Reflect.defineMetadata("design:paramtypes", [PlaygroundAgentActionsService], PlaygroundAgentActionsController);
	Reflect.defineMetadata("design:paramtypes", [PlaygroundSandboxService], PlaygroundSandboxController);
	t.mock.method(JwtAuthGuard.prototype, "canActivate", (context: ExecutionContext) => { context.switchToHttp().getRequest().user = { id: 42 }; return true; });
	const observed: unknown[] = [];
	const capture = async (body: unknown) => { observed.push(body); return { version: 1 }; };
	@Module({ controllers: [PlaygroundAgentController, PlaygroundAgentActionsController, PlaygroundSandboxController, OrdinaryController], providers: [
		{ provide: BillingService, useValue: { resolveTierFor: async () => "pro" } },
		{ provide: DesktopGatewayService, useValue: { agentTurn: async (_account: number, _tier: string, body: unknown) => ({ kind: "completed", payload: await capture(body) }) } },
		{ provide: PlaygroundAgentActionsService, useValue: { prepare: (_account: number, body: unknown) => capture(body), execute: (_account: number, _id: string, body: unknown) => capture(body) } },
		{ provide: PlaygroundSandboxService, useValue: { request: (_account: number, _method: string, _path: string, body: unknown) => capture(body) } },
	] }) class FixtureModule {}
	const app = await NestFactory.create(FixtureModule, { logger: false });
	app.useGlobalFilters({ catch: (error: unknown, host) => host.switchToHttp().getResponse().status(500).json({ fixtureError: error instanceof Error ? error.stack : String(error) }) });
	app.useGlobalPipes(new TrimStringsPipe(), new ValidationPipe({ transform: true, whitelist: true, forbidUnknownValues: false }));
	try {
		await app.init();
		const id = "00000000-0000-4000-8000-000000000042";
		const exact = { message: "  Original instructions\n", call: { id: "call_1", name: "write_file", arguments: '  {"path":"main.py","text":"  indented\\n"} \n' } };
		for (const path of ["/api/playground/agent/turn", "/api/desktop/agent/turn", "/api/playground/agent/actions", `/api/playground/agent/actions/${id}/execute`]) {
			await request(app.getHttpServer()).post(path).send(exact).expect(response => assert.ok(response.status < 300, `${path}: ${response.status} ${JSON.stringify(response.body)}`));
			assert.deepEqual(observed.at(-1), exact);
		}
		const source = { path: "main.py", text: "  indented source\n\n" };
        await request(app.getHttpServer()).put(`/api/playground/sandbox/${id}/file`).send({ ...source, approved: true }).expect(200);
		assert.deepEqual(observed.at(-1), source);
		await request(app.getHttpServer()).post("/ordinary-trim-fixture").send({ name: "  still trimmed  " }).expect(201, { name: "still trimmed" });
	} finally { await app.close(); }
});
