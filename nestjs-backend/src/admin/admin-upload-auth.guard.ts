import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { AdminService } from "./admin.service";

@Injectable()
export class AdminUploadAuthGuard implements CanActivate {
	constructor(private readonly adminService: AdminService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();
		await this.adminService.requireAdmin(request);
		return true;
	}
}
