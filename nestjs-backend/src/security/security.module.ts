import { Global, Module } from "@nestjs/common";
import { OpaPolicyService } from "./policy/opa-policy.service";
import { ServiceAssertionService } from "./assertions/service-assertion.service";
import { CsrfService } from "./csrf/csrf.service";

@Global()
@Module({
	providers: [OpaPolicyService, ServiceAssertionService, CsrfService],
	exports: [OpaPolicyService, ServiceAssertionService, CsrfService],
})
export class SecurityModule {}
