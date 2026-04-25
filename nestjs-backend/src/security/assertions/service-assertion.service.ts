import { Injectable } from "@nestjs/common";
import * as serviceAssertions from "../../common/utils/serviceAssertions";

interface VerifyResult {
	ok: boolean;
	reason?: string;
	claims?: Record<string, unknown>;
}

@Injectable()
export class ServiceAssertionService {
	constructor() {}

	verify(token: string, expectedScope: string, requireJti = false): VerifyResult {
		return serviceAssertions.verifyServiceAssertion(token, { expectedScope, requireJti });
	}

	issue(options: any): string {
		return serviceAssertions.issueServiceAssertion(options).token;
	}
}
