import { Global, Module } from "@nestjs/common";
import { RustCryptoAdapter } from "./rust-crypto/rust-crypto.adapter";
import { JavaInvoiceAdapter } from "./java-invoice/java-invoice.adapter";
import { GoOpsAdapter } from "./go-ops/go-ops.adapter";
import { KotlinSubscriptionsAdapter } from "./kotlin-subscriptions/kotlin-subscriptions.adapter";

@Global()
@Module({
	providers: [RustCryptoAdapter, JavaInvoiceAdapter, GoOpsAdapter, KotlinSubscriptionsAdapter],
	exports: [RustCryptoAdapter, JavaInvoiceAdapter, GoOpsAdapter, KotlinSubscriptionsAdapter],
})
export class IntegrationsModule {}
