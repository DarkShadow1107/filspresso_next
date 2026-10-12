import { Injectable, Logger } from "@nestjs/common";

/**
 * The one place money would leave the building.
 *
 * Nothing else in the codebase touches a payment provider. Every caller -- subscription
 * checkout, the renewal job, the wallet top-up, automatic refill, refunds -- goes through
 * this interface, so wiring a provider later is a matter of binding a different
 * implementation here rather than rewriting four flows that each have their own idea of what
 * a charge means.
 *
 * ## The simulated provider is not a stub
 *
 * It is the implementation that is actually running. It "succeeds" because there is nothing
 * to charge, and it fails on demand so the failure paths are testable before a provider
 * exists. The alternative -- pretending there is no payment layer -- is how a product ends
 * up with four hand-rolled charge implementations and no seam to replace them.
 */

export type ChargeRequest = {
	/** The card being charged. Null when the account has no default card. */
	cardId: number | null;
	amountRon: number;
	currency: string;
	/**
	 * Stable across retries of the *same* purchase and different between purchases.
	 *
	 * A provider must see this twice only if the customer really paid twice. Every caller
	 * passes something derived from the account and the period, never a random value, so a
	 * retry after a crash cannot become a second charge.
	 */
	reference: string;
	description: string;
};

export type ChargeResult =
	| { ok: true; providerReference: string }
	| { ok: false; code: string; message: string; retryable: boolean };

export type RefundRequest = {
	providerReference: string;
	amountRon: number;
	reason: string;
};

/**
 * An abstract class rather than an interface, so it can serve as the injection token.
 *
 * With an interface, `{ provide: ChargeProvider, useClass: ... }` does not compile --
 * interfaces exist only in the type system and cannot be used as a value. An abstract class
 * is the conventional NestJS way to have one definition that is both the contract and the
 * token, which is what keeps the binding in one place.
 */
export abstract class ChargeProvider {
	abstract readonly name: string;
	abstract charge(request: ChargeRequest): Promise<ChargeResult>;
	abstract refund(request: RefundRequest): Promise<ChargeResult>;
}

/**
 * The stand-in used while no provider is connected.
 *
 * Failure is simulated from the card id's last digit, which is deterministic and therefore
 * reproducible in a test, rather than from a random roll nobody can re-run. A card ending in
 * a specific digit lets a live check drive the declined path end to end.
 *
 * `SIMULATED_CHARGE_FAILURE_RATE` additionally rejects a share of charges at random, which is
 * how the retry and give-up paths in the refill and renewal jobs were exercised.
 */
@Injectable()
export class SimulatedChargeProvider implements ChargeProvider {
	readonly name = "simulated";
	private readonly logger = new Logger(SimulatedChargeProvider.name);
	private attempts = 0;

	private readonly failureRate = readRate(process.env.SIMULATED_CHARGE_FAILURE_RATE);

	async charge(request: ChargeRequest): Promise<ChargeResult> {
		this.attempts += 1;

		if (request.cardId == null) {
			return {
				ok: false,
				code: "no_card",
				message: "There is no default card to charge.",
				retryable: false,
			};
		}
		if (!Number.isFinite(request.amountRon) || request.amountRon <= 0) {
			return {
				ok: false,
				code: "invalid_amount",
				message: `Refusing to charge ${request.amountRon}.`,
				retryable: false,
			};
		}

		// Deterministic decline, for the failure paths. Documented in the README next to the
		// no-provider note so nobody has to read this file to exercise them.
		if (request.cardId % 10 === 7) {
			return {
				ok: false,
				code: "card_declined",
				message: "The card was declined.",
				retryable: true,
			};
		}

		if (this.failureRate > 0 && hash(`${request.reference}:${this.attempts}`) / 2 ** 32 < this.failureRate) {
			return {
				ok: false,
				code: "provider_unavailable",
				message: "The payment provider is unavailable.",
				retryable: true,
			};
		}

		this.logger.log(
			`[simulated] charged ${request.amountRon} ${request.currency} against card ${request.cardId} ` +
				`(${request.description}, ref ${request.reference}) -- no money moved`,
		);
		return { ok: true, providerReference: `sim_${request.reference}` };
	}

	async refund(request: RefundRequest): Promise<ChargeResult> {
		this.logger.log(
			`[simulated] refunded ${request.amountRon} against ${request.providerReference} ` +
				`(${request.reason}) -- no money moved`,
		);
		return { ok: true, providerReference: `sim_refund_${request.providerReference}` };
	}
}

/** Stable 32-bit hash, so the random failure path is reproducible rather than flaky. */
function hash(input: string): number {
	let h = 2166136261;
	for (let i = 0; i < input.length; i += 1) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function readRate(raw: string | undefined): number {
	const value = Number(raw ?? "0");
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.min(1, value);
}

/**
 * Is automatic refill allowed to run at all?
 *
 * A kill switch that defaults to on, because the feature is a promise the product already
 * makes to customers. Set AUTO_REFILL_ENABLED=false to stop it taking effect immediately
 * without a deploy.
 */
export function autoRefillEnabled(): boolean {
	return String(process.env.AUTO_REFILL_ENABLED ?? "true").trim().toLowerCase() !== "false";
}