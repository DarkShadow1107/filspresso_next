"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsModule = void 0;
const common_1 = require("@nestjs/common");
const rust_crypto_adapter_1 = require("./rust-crypto/rust-crypto.adapter");
const java_invoice_adapter_1 = require("./java-invoice/java-invoice.adapter");
const go_ops_adapter_1 = require("./go-ops/go-ops.adapter");
const kotlin_subscriptions_adapter_1 = require("./kotlin-subscriptions/kotlin-subscriptions.adapter");
let IntegrationsModule = class IntegrationsModule {
};
exports.IntegrationsModule = IntegrationsModule;
exports.IntegrationsModule = IntegrationsModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [rust_crypto_adapter_1.RustCryptoAdapter, java_invoice_adapter_1.JavaInvoiceAdapter, go_ops_adapter_1.GoOpsAdapter, kotlin_subscriptions_adapter_1.KotlinSubscriptionsAdapter],
        exports: [rust_crypto_adapter_1.RustCryptoAdapter, java_invoice_adapter_1.JavaInvoiceAdapter, go_ops_adapter_1.GoOpsAdapter, kotlin_subscriptions_adapter_1.KotlinSubscriptionsAdapter],
    })
], IntegrationsModule);
