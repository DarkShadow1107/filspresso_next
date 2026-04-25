"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRACT_VALIDATORS = void 0;
exports.assertServiceContract = assertServiceContract;
const MAX_STRING = 4096;
function assertObject(value, context) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${context} must be an object`);
    }
}
function assertString(value, context, maxLength = 512) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${context} must be a non-empty string`);
    }
    if (value.length > maxLength) {
        throw new Error(`${context} exceeds max length ${maxLength}`);
    }
}
function assertOptionalString(value, context, maxLength = 512) {
    if (value === undefined || value === null)
        return;
    if (typeof value !== "string") {
        throw new Error(`${context} must be a string`);
    }
    if (value.length > maxLength) {
        throw new Error(`${context} exceeds max length ${maxLength}`);
    }
}
function assertNumber(value, context) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${context} must be a finite number`);
    }
}
function assertArray(value, context) {
    if (!Array.isArray(value)) {
        throw new Error(`${context} must be an array`);
    }
}
function assertOperationId(value, context = "operationId") {
    assertString(value, context, 128);
    if (!/^[A-Za-z0-9:_-]{12,128}$/.test(value)) {
        throw new Error(`${context} must match [A-Za-z0-9:_-]{12,128}`);
    }
}
function validateGoOpsEventIngestV1(payload) {
    assertObject(payload, "go_ops payload");
    assertString(payload.eventType, "go_ops payload.eventType", 96);
    assertString(payload.source, "go_ops payload.source", 64);
    if (payload.operationId !== undefined) {
        assertOperationId(payload.operationId, "go_ops payload.operationId");
    }
    assertObject(payload.payload || {}, "go_ops payload.payload");
}
function validateKotlinQuoteRequestV1(payload) {
    assertObject(payload, "kotlin quote request");
    assertString(payload.tier, "kotlin quote request.tier", 32);
    assertString(payload.billingCycle, "kotlin quote request.billingCycle", 32);
    assertString(payload.currentTier, "kotlin quote request.currentTier", 32);
}
function validateKotlinQuoteResponseV1(payload) {
    assertObject(payload, "kotlin quote response");
    if (payload.quote !== undefined) {
        assertObject(payload.quote, "kotlin quote response.quote");
    }
}
function validateRustCommitmentRequestV1(payload) {
    assertObject(payload, "rust commitment request");
    assertString(payload.domain, "rust commitment request.domain", 128);
    if (payload.operation_id) {
        assertOperationId(payload.operation_id, "rust commitment request.operation_id");
    }
    if (payload.payload !== undefined) {
        assertOptionalString(payload.payload, "rust commitment request.payload", MAX_STRING);
    }
    if (payload.payload_json !== undefined) {
        assertObject(payload.payload_json, "rust commitment request.payload_json");
    }
}
function validateRustCommitmentResponseV1(payload) {
    assertObject(payload, "rust commitment response");
    assertString(payload.algorithm, "rust commitment response.algorithm", 32);
    assertString(payload.domain, "rust commitment response.domain", 128);
    assertString(payload.canonical_payload, "rust commitment response.canonical_payload", MAX_STRING);
    assertString(payload.commitment_sha3_256, "rust commitment response.commitment_sha3_256", 128);
    if (payload.operation_id !== undefined && payload.operation_id !== null) {
        assertOperationId(payload.operation_id, "rust commitment response.operation_id");
    }
}
function validateRustVerifyRequestV1(payload) {
    assertObject(payload, "rust verify request");
    assertString(payload.domain, "rust verify request.domain", 128);
    assertString(payload.commitment_sha3_256, "rust verify request.commitment_sha3_256", 128);
    if (payload.operation_id) {
        assertOperationId(payload.operation_id, "rust verify request.operation_id");
    }
    if (payload.payload !== undefined) {
        assertOptionalString(payload.payload, "rust verify request.payload", MAX_STRING);
    }
    if (payload.payload_json !== undefined) {
        assertObject(payload.payload_json, "rust verify request.payload_json");
    }
}
function validateRustVerifyResponseV1(payload) {
    assertObject(payload, "rust verify response");
    if (typeof payload.valid !== "boolean") {
        throw new Error("rust verify response.valid must be boolean");
    }
    assertString(payload.expected_commitment_sha3_256, "rust verify response.expected_commitment_sha3_256", 128);
    if (payload.operation_id !== undefined && payload.operation_id !== null) {
        assertOperationId(payload.operation_id, "rust verify response.operation_id");
    }
}
function validateInvoiceRenderRequestV1(payload) {
    assertObject(payload, "invoice request");
    assertString(payload.invoiceNumber, "invoice request.invoiceNumber", 96);
    assertString(payload.orderNumber, "invoice request.orderNumber", 96);
    assertArray(payload.items, "invoice request.items");
    for (const [index, item] of payload.items.entries()) {
        assertObject(item, `invoice request.items[${index}]`);
        assertString(item.name, `invoice request.items[${index}].name`, 256);
        assertNumber(item.quantity, `invoice request.items[${index}].quantity`);
        assertNumber(item.unitPrice, `invoice request.items[${index}].unitPrice`);
        assertNumber(item.totalPrice, `invoice request.items[${index}].totalPrice`);
    }
}
exports.CONTRACT_VALIDATORS = {
    go_ops_event_ingest_v1: validateGoOpsEventIngestV1,
    kotlin_quote_request_v1: validateKotlinQuoteRequestV1,
    kotlin_quote_response_v1: validateKotlinQuoteResponseV1,
    rust_commitment_request_v1: validateRustCommitmentRequestV1,
    rust_commitment_response_v1: validateRustCommitmentResponseV1,
    rust_verify_request_v1: validateRustVerifyRequestV1,
    rust_verify_response_v1: validateRustVerifyResponseV1,
    invoice_render_request_v1: validateInvoiceRenderRequestV1,
};
function assertServiceContract(contractName, payload) {
    const validator = exports.CONTRACT_VALIDATORS[contractName];
    if (!validator) {
        throw new Error(`Unknown service contract: ${contractName}`);
    }
    validator(payload);
    return true;
}
