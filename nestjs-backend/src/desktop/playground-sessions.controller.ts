import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PlaygroundRunEventsService } from "./playground-run-events.service";
import { InvalidSessionInputError, PlaygroundSessionsService } from "./playground-sessions.service";

type Caller = { user?: { id?: number | string } };

/** Same shape the sandbox controller already validates with; these ids are client-supplied. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUN_ID_PATTERN = /^(dsk-[0-9a-f]{24}|exec-[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

function accountId(req: Caller): number {
	const parsed = Number(req.user?.id);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException("Authentication is required.");
	return parsed;
}

/**
 * Durable Playground state: resume sessions, versioned run replay, deletion controls.
 *
 * Jwt-guarded, because every row is account-scoped data; and every mutation is throttled
 * like the money and load endpoints -- none of these routes are on a hot generation path
 * (chat never waits on them), but a client that wrote a checkpoint every keystroke would
 * still make the sessions table a write amp, so the cheap version of defending it lives here.
 */
@Controller("api/playground")
@UseGuards(JwtAuthGuard)
export class PlaygroundSessionsController {
	constructor(
		private readonly sessions: PlaygroundSessionsService,
		private readonly events: PlaygroundRunEventsService,
	) {}

	@Get("sessions")
	list(@Req() req: Caller, @Query("limit") limit?: string, @Query("offset") offset?: string) {
		return this.sessions.list(accountId(req), Number(limit), Number(offset));
	}

	@Post("sessions")
	@Throttle({ default: { limit: 30, ttl: 60_000 } })
	async create(@Req() req: Caller, @Body() body: Record<string, unknown>) {
		try { return await this.sessions.create(accountId(req), body ?? {}); }
		catch (error) {
			if (error instanceof InvalidSessionInputError) throw new BadRequestException({ error: "INVALID_SESSION_INPUT", message: error.message });
			throw error;
		}
	}

	@Get("sessions/:uuid")
	get(@Req() req: Caller, @Param("uuid") uuid: string) {
		if (!UUID_PATTERN.test(uuid)) throw new BadRequestException("Invalid session id.");
		return this.sessions.get(accountId(req), uuid);
	}

	@Patch("sessions/:uuid")
	@Throttle({ default: { limit: 60, ttl: 60_000 } })
	async update(@Req() req: Caller, @Param("uuid") uuid: string, @Body() body: Record<string, unknown>) {
		if (!UUID_PATTERN.test(uuid)) throw new BadRequestException("Invalid session id.");
		try { return await this.sessions.update(accountId(req), uuid, body ?? {}); }
		catch (error) {
			if (error instanceof InvalidSessionInputError) throw new BadRequestException({ error: "INVALID_SESSION_INPUT", message: error.message });
			throw error;
		}
	}

	@Delete("sessions/:uuid")
	async delete(@Req() req: Caller, @Param("uuid") uuid: string, @Query("purge") purge?: string) {
		if (!UUID_PATTERN.test(uuid)) throw new BadRequestException("Invalid session id.");
		const removed = await this.sessions.delete(accountId(req), uuid);
		if (removed && purge === "1") {
			// Retention consent piggybacks on the delete itself: the deleted row is kept as
			// "beyond user sight", and the linked events go with it in the same gesture.
			const purged = await this.events.purgeSessionEvents(accountId(req), uuid);
			return { message: "Session deleted", purgedEvents: purged };
		}
		return { message: "Session deleted" };
	}

	@Get("runs")
	@Header("Cache-Control", "no-store")
	@Throttle({ default: { limit: 60, ttl: 60_000 } })
	listRuns(@Req() req: Caller, @Query("limit") limit?: string, @Query("sessionUuid") sessionUuid?: string) {
		if (sessionUuid !== undefined && !UUID_PATTERN.test(sessionUuid)) throw new BadRequestException("Invalid session id.");
		return this.events.list(accountId(req), Number(limit), sessionUuid);
	}

	/**
	 * Replay one run. Account-scoped twice over: a run id guessed by someone else is simply
	 * an empty list, because every query carries the caller's account id first.
	 */
	@Get("runs/:runId")
	@Header("Cache-Control", "no-store")
	@Throttle({ default: { limit: 120, ttl: 60_000 } })
	replay(@Req() req: Caller, @Param("runId") runId: string, @Query("limit") limit?: string, @Query("afterSequence") afterSequence?: string) {
		if (!RUN_ID_PATTERN.test(runId)) throw new BadRequestException("Invalid run id.");
		if (afterSequence !== undefined && (!/^(?:-1|\d+)$/.test(afterSequence) || !Number.isSafeInteger(Number(afterSequence)) || Number(afterSequence) > 2_147_483_647)) throw new BadRequestException("Invalid event cursor.");
		return this.events.replay(accountId(req), runId, Number(limit), afterSequence === undefined ? -1 : Number(afterSequence));
	}

	/** Deletion control for run history: one session's events, or the whole account's when sessionUuid is absent. */
	@Delete("runs")
	async purge(@Req() req: Caller, @Query("sessionUuid") sessionUuid?: string) {
		const caller = accountId(req);
		if (sessionUuid) {
			if (!UUID_PATTERN.test(sessionUuid)) throw new BadRequestException("Invalid session id.");
			const purged = await this.events.purgeSessionEvents(caller, sessionUuid);
			return { message: "Run history purged", purgedEvents: purged };
		}
		const purged = await this.events.purgeAccountEvents(caller);
		return { message: "Run history purged", purgedEvents: purged };
	}
}
