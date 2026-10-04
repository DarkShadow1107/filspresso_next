/**
 * Test environment defaults.
 *
 * `auth-tokens.ts` validates the signing key at import time, so any test that
 * transitively pulls it in needs `JWT_SECRET` present before that module loads.
 * Importing this file first is the supported way to do that -- import order is
 * preserved under CommonJS, so the assignment runs before the importer.
 *
 * `encryption.ts` does the same: it throws at import time without a root key, so the
 * Phase 8 test that asserts the derived-key cache is transparent needs one too.
 *
 * These are throwaway values used only by the unit tests; nothing here reaches a
 * real deployment.
 */
process.env.JWT_SECRET ||= "unit-test-jwt-secret-not-used-in-production";
process.env.JWT_ISSUER ||= "http://localhost:4000";
process.env.JWT_AUDIENCE ||= "filspresso-users";

// 32 bytes of hex. The key length is the only thing the module validates; the value is
// irrelevant because nothing encrypted in a test is ever decrypted outside it.
process.env.ENCRYPTION_KEY ||= `hex:${"ab".repeat(32)}`;

export {};