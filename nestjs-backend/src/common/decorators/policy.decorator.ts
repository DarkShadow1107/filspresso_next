import { SetMetadata } from "@nestjs/common";

export const POLICY_METADATA_KEY = "policy_context";

export interface PolicyContext {
	resource: string;
	action: string;
}

export const Policy = (context: PolicyContext) => SetMetadata(POLICY_METADATA_KEY, context);
