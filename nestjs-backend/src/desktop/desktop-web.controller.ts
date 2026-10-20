import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { DesktopWebService } from "./desktop-web.service";

/** What JwtAuthGuard guarantees on the request it has let through. */
type DesktopRequest = { user?: { id?: number | string } };

/**
 * The web tools, for the desktop client.
 *
 * ## Why they are on the server and not in the sandbox
 *
 * The sandbox is a Hyper-V virtual machine with no network adapter, so generated code cannot
 * reach the network. The model still needs to look things up, so the search and the fetch
 * happen here, on the host, and the harness writes the result into the sandbox as a file the
 * model can read. The sandbox never gets a socket, so the boundary is unchanged.
 *
 * The cost of that arrangement is that this endpoint is reachable by anyone who can
 * authenticate, and it can be made to fetch things. It is fenced accordingly -- public
 * addresses only, every redirect re-checked, bodies capped -- and it is rate limited
 * separately from the rest of the API, because an outbound fetch is far more expensive than
 * a database read.
 */
@Controller("api/desktop")
@UseGuards(JwtAuthGuard)
export class DesktopWebController {
	constructor(private readonly web: DesktopWebService) {}

	/**
	 * Search the web, or fetch a page.
	 *
	 * One endpoint rather than two, because they are one tool from the model's point of view:
	 * "give me what the web says about this".
	 */
	@Post("web")
	// 200 rather than Nest's default 201: this returns a result, it does not create
	// anything. A 201 on a tool call tells the client to look for a resource that does not
	// exist.
	@HttpCode(HttpStatus.OK)
	async tool(@Req() req: DesktopRequest, @Body() body: Record<string, unknown>) {
		const accountId = Number(req.user?.id);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			return { error: "ACCOUNT_REQUIRED" };
		}

		const action = String(body?.action ?? "search").trim().toLowerCase();

		if (action === "search") {
			const results = await this.web.search(String(body?.query ?? ""), Number(body?.limit ?? 10));
			return { action, results };
		}

		if (action === "fetch") {
			const page = await this.web.fetchPage(String(body?.url ?? ""), Number(body?.limit ?? 20_000));
			return { action, page };
		}

		return { error: "unknown action", action };
	}
}
