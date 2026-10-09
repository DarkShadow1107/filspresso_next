import { BadRequestException } from "@nestjs/common";

/**
 * The anonymous visitor's identifier, and the only validation of it.
 *
 * ## Strict by design
 *
 * This value is a client-supplied header that keys a budget, so anything loose about it is
 * a way to get someone else's budget, or to create unlimited ones. Earlier revisions of this
 * accepted an over-long value by truncating it to 64 characters -- chosen for consistency
 * with `kafelot_anonymous_users.fingerprint VARCHAR(64)`. That was the wrong call:
 * truncating is silent, it means two distinct inputs can collapse onto one budget, and
 * "the column is wide enough" is a storage detail, not a statement about what a valid
 * identifier is. Rejected instead, loudly.
 *
 * ## The format
 *
 * A version 4 UUID, exactly as `crypto.randomUUID()` produces: 8-4-4-4-12 lowercase hex with
 * a `4` version nibble and a `[89ab]` variant nibble. The version and variant bits are
 * checked because a validator that accepts any 36 hex characters is not really validating a
 * UUID, and the client mints real v4 values -- so anything else did not come from our code.
 *
 * ## Two layers, one rule
 *
 * The pre-flight check in `kafelot.service.ts` and the metering endpoint both call this.
 * They were previously separate and disagreed: one truncated to 64, the other accepted
 * whatever it was given. Two copies of one rule is how that happened, so there is one.
 */

const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 36 characters, and no more: the length is implied by the pattern, checked explicitly too. */
export const FINGERPRINT_MAX_LENGTH = 36;

/** The header both layers read. */
export const FINGERPRINT_HEADER = "x-kafelot-fingerprint";

/**
 * Validate and return a fingerprint, or throw 400.
 *
 * A 400 rather than a 401 on purpose: the caller *is* anonymous by design, so this is not
 * an authentication failure. It is a malformed request. Refusing it with 401 would tell an
 * anonymous visitor they failed to authenticate, which is both wrong and misleading.
 */
export function parseFingerprint(raw: unknown): string {
	if (typeof raw !== "string") {
		throw new BadRequestException(`${FINGERPRINT_HEADER} must be a string`);
	}
	// No trimming and no slicing. Trimming would make " <uuid> " valid, which means two
	// distinct header values address one budget; slicing is truncation by another name.
	const value = raw;
	if (value.length === 0) {
		throw new BadRequestException(`${FINGERPRINT_HEADER} is required`);
	}
	if (value.length > FINGERPRINT_MAX_LENGTH) {
		throw new BadRequestException(
			`${FINGERPRINT_HEADER} must be at most ${FINGERPRINT_MAX_LENGTH} characters, got ${value.length}`,
		);
	}
	if (!UUID_V4.test(value)) {
		throw new BadRequestException(`${FINGERPRINT_HEADER} must be a version 4 UUID`);
	}
	return value;
}

/** True when the value is a usable fingerprint. Never throws. */
export function isValidFingerprint(raw: unknown): boolean {
	return typeof raw === "string" && raw.length <= FINGERPRINT_MAX_LENGTH && UUID_V4.test(raw);
}

/** Pull the fingerprint off a request-like object, or null when there is not a valid one. */
export function fingerprintFrom(headers: Record<string, unknown> | undefined): string | null {
	const raw = headers?.[FINGERPRINT_HEADER];
	if (typeof raw !== "string") return null;
	return isValidFingerprint(raw) ? raw : null;
}
