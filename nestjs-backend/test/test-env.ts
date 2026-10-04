/**
 * Test environment defaults.
 *
 * `auth-tokens.ts` validates the signing key at import time, so any test that
 * transitively pulls it in needs `JWT_SECRET` present before that module loads.
 * Importing this file first is the supported way to do that -- import order is
 * preserved under CommonJS, so the assignment runs before the importer.
 *
 * These are throwaway values used only by the unit tests; nothing here reaches a
 * real deployment.
 */
process.env.JWT_SECRET ||= "unit-test-jwt-secret-not-used-in-production";
process.env.JWT_ISSUER ||= "http://localhost:4000";
process.env.JWT_AUDIENCE ||= "filspresso-users";

export {};
