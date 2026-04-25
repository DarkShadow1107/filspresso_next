import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
	getInfo() {
		return {
			name: "Filspresso NestJS Backend",
			status: "ok",
			timestamp: new Date().toISOString(),
		};
	}
}
