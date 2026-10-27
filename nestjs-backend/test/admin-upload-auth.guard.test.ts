import "./test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { Controller, Module, Post, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors, type ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { NestFactory } from "@nestjs/core";
import { FileInterceptor } from "@nestjs/platform-express";
import request from "supertest";
import multer from "multer";
import { AdminUploadAuthGuard } from "../src/admin/admin-upload-auth.guard";
import { AdminController } from "../src/admin/admin.controller";
import { AdminService } from "../src/admin/admin.service";

let authorized = false;
let fileFilterCalls = 0;

@Controller("upload-auth-probe")
class UploadAuthProbeController {
	@Post()
	@UseGuards(AdminUploadAuthGuard)
	@UseInterceptors(FileInterceptor("image", {
		storage: multer.memoryStorage(),
		fileFilter: (_req, _file, callback) => {
			fileFilterCalls += 1;
			callback(null, true);
		},
	}))
	upload(@UploadedFile() file: Express.Multer.File | undefined) {
		return { uploaded: Boolean(file) };
	}
}

const authService = {
	async requireAdmin() {
		if (!authorized) throw new UnauthorizedException({ error: "Admin authentication required" });
	},
};

@Module({
	controllers: [UploadAuthProbeController],
	providers: [AdminUploadAuthGuard, { provide: AdminService, useValue: authService }],
})
class UploadAuthProbeModule {}

test("the production coffee-image route has an auth guard ahead of its upload interceptor", () => {
	const guards = Reflect.getMetadata(GUARDS_METADATA, AdminController.prototype.uploadImage) as unknown[] | undefined;
	assert.ok(guards?.includes(AdminUploadAuthGuard));
});

test("multipart parsing stops before Multer when admin authentication fails", async (t) => {
	authorized = false;
	fileFilterCalls = 0;
	Reflect.defineMetadata("design:paramtypes", [AdminService], AdminUploadAuthGuard);
	t.mock.method(AdminUploadAuthGuard.prototype, "canActivate", async () => {
		await authService.requireAdmin();
		return true;
	});
	const app = await NestFactory.create(UploadAuthProbeModule, { logger: ["error"] });
	try {
		await app.init();
		await request(app.getHttpServer())
			.post("/upload-auth-probe")
			.attach("image", Buffer.from("not-an-image"), { filename: "upload.png", contentType: "image/png" })
			.expect(401);
		assert.equal(fileFilterCalls, 0, "Multer must not start parsing an unauthenticated upload");
	} finally {
		await app.close();
	}
});

test("the guard delegates authentication to AdminService", async () => {
	const guard = new AdminUploadAuthGuard(authService as unknown as AdminService);
	const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as unknown as ExecutionContext;
	authorized = false;
	await assert.rejects(guard.canActivate(context), UnauthorizedException);
	authorized = true;
	assert.equal(await guard.canActivate(context), true);
});

test("authenticated multipart uploads still reach Multer and the route", async (t) => {
	authorized = true;
	fileFilterCalls = 0;
	Reflect.defineMetadata("design:paramtypes", [AdminService], AdminUploadAuthGuard);
	t.mock.method(AdminUploadAuthGuard.prototype, "canActivate", async () => {
		await authService.requireAdmin();
		return true;
	});
	const app = await NestFactory.create(UploadAuthProbeModule, { logger: ["error"] });
	try {
		await app.init();
		await request(app.getHttpServer())
			.post("/upload-auth-probe")
			.attach("image", Buffer.from("fixture"), { filename: "upload.png", contentType: "image/png" })
			.expect(201, { uploaded: true });
		assert.equal(fileFilterCalls, 1);
	} finally {
		await app.close();
	}
});
