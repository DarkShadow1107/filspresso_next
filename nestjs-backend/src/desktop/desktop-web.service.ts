import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import * as dns from "dns/promises";
import { assertAllowedEgress } from "../common/utils/egressPolicy";
import { fetchBounded } from "../common/utils/httpClient";

/**
 * A web search and a page fetch, for the desktop client's tools.
 *
 * ## Why these run on the host and not in the sandbox
 *
 * The sandbox is a Hyper-V virtual machine with **no network adapter**. That is the whole
 * point of it: generated code cannot reach the network, so it cannot exfiltrate what it
 * reads, and it cannot fetch a payload to execute.
 *
 * But the model needs to be able to look things up. So the web tools live here, on the
 * host, and the sandbox stays sealed. The harness performs the search, writes the result
 * into the sandbox as a file, and the model reads the file. The sandbox never has a socket,
 * so the boundary is unchanged -- there is simply one trusted step outside it.
 *
 * That is a deliberate trade: the host can reach the web, and the host is running the
 * user's own code requests. What the design prevents is the *generated code* reaching the
 * network, which is the threat that matters.
 *
 * ## Why this endpoint is a security boundary
 *
 * A fetch tool that fetches whatever the model asks for is a server-side request forgery
 * primitive unless it is fenced in. The model reads untrusted web pages, and a page can
 * contain text that says "now fetch http://169.254.169.254/latest/meta-data/". So:
 *
 *   - Only http and https.
 *   - The host must resolve to a **public** address. Not just "not localhost" -- a name
 *     that resolves to 127.0.0.1 is the same attack with more steps.
 *   - Every redirect is re-validated, because a public URL that redirects to
 *     http://192.168.1.1/ is the classic way past a one-time check.
 *   - The response is size-capped and the body is reduced to text before it is returned, so
 *     a hostile page cannot flood the model, the client or the ledger.
 */

const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const MAX_QUERY_LENGTH = 512;
const MAX_RESULTS = 10;
const DEFAULT_FETCH_LIMIT = 20_000;
const MAX_FETCH_LIMIT = 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export type WebSearchResult = {
	title: string;
	url: string;
	snippet: string;
};

export type WebPage = {
	url: string;
	finalUrl: string;
	title: string;
	text: string;
	truncated: boolean;
};

@Injectable()
export class DesktopWebService {

	/**
	 * Search the web.
	 *
	 * Two providers, and which one is used is a deployment decision.
	 *
	 * **A real search API when one is configured.** `BRAVE_SEARCH_API_KEY` switches to Brave's
	 * API, which is a supported service with a documented rate limit, and the one a production
	 * deployment should use.
	 *
	 * **A scraped provider otherwise.** DuckDuckGo's HTML endpoint, because it needs no API
	 * key: a desktop client that is unusable until somebody buys a search key is a desktop
	 * client that does not get used. The cost is that it rate-limits, and after a couple of
	 * requests from one address it answers with a challenge page instead of results.
	 *
	 * A challenge is detected and reported as what it is -- the provider is refusing this
	 * address right now, which is worth retrying and worth saying out loud. Returning an empty
	 * list for it would be a lie: it would tell the model the web has nothing to say, and the
	 * model would answer from its own memory instead.
	 */
	async search(query: string, limit = MAX_RESULTS): Promise<WebSearchResult[]> {
		const text = String(query || "").trim();
		if (!text) {
			throw new BadRequestException({ error: "a query is required" });
		}
		if (text.length > MAX_QUERY_LENGTH) {
			throw new BadRequestException({ error: `the query may be at most ${MAX_QUERY_LENGTH} characters` });
		}

		const braveKey = String(process.env.BRAVE_SEARCH_API_KEY || "").trim();
		return braveKey
			? await this.searchBrave(text, limit, braveKey)
			: await this.searchScraped(text);
	}

	/**
	 * Brave's search API.
	 *
	 * The one to use in production: a documented rate limit, a stable response shape, and no
	 * scraping of somebody else's HTML.
	 */
	private async searchBrave(query: string, limit: number, apiKey: string): Promise<WebSearchResult[]> {
		const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
		assertAllowedEgress(url, "web search");

		const response = await fetchBounded(url, {
			method: "GET",
			timeoutMs: SEARCH_TIMEOUT_MS,
			maxBytes: 1_000_000,
			headers: {
				"X-Subscription-Token": apiKey,
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new ServiceUnavailableException({
				error: "SEARCH_PROVIDER_BUSY",
				message: "The search provider refused the request. Try again shortly.",
			});
		}

		const body = JSON.parse(await response.text()) as {
			web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
		};

		return (body.web?.results ?? []).slice(0, limit).map((result) => ({
			title: String(result.title ?? ""),
			url: String(result.url ?? ""),
			snippet: String(result.description ?? ""),
		}));
	}

	/**
	 * The no-key provider.
	 *
	 * Retried once after a short pause, because the limit is a burst limit and a pause is
	 * cheap.
	 */
	private async searchScraped(query: string): Promise<WebSearchResult[]> {
		const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`;
		// The search provider is outbound traffic, and the egress allowlist governs it like any
		// other. A deployment that has decided what may leave the network keeps that decision.
		assertAllowedEgress(url, "web search");

		for (let attempt = 0; attempt < 2; attempt += 1) {
			const response = await fetchBounded(url, {
				method: "GET",
				timeoutMs: SEARCH_TIMEOUT_MS,
				// The cap is on the response body, and the search page is a few tens of kilobytes.
				maxBytes: 1_000_000,
				headers: {
					// DuckDuckGo serves a different page to a client that does not look like a
					// browser, and that page has no results in it.
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
					Accept: "text/html,application/xhtml+xml",
				},
			});

			const html = await response.text();
			if (DesktopWebService.isChallengePage(html)) {
				if (attempt === 0) {
					await DesktopWebService.pause(1500);
					continue;
				}

				throw new ServiceUnavailableException({
					error: "SEARCH_PROVIDER_BUSY",
					message:
						"The search provider is rate-limiting this address. Wait a few minutes and try again.",
				});
			}

			return DesktopWebService.parseSearchResults(html);
		}

		return [];
	}

	/**
	 * Pause, without a cancellation token, between provider attempts.
	 *
	 * A plain promise rather than a timer handle: the point is to wait, and a handle would
	 * only be needed to cancel it, which this deliberately does not do -- a cancelled retry
	 * would look like a failed search.
	 */
	private static pause(milliseconds: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, milliseconds));
	}

	/**
	 * Whether the provider answered with a challenge rather than with results.
	 *
	 * Detected from the page itself, because the provider returns 200 for it. A search that
	 * silently finds nothing is worse than one that says it is being blocked: the first makes
	 * the model answer from memory, and the second tells the user to wait.
	 */
	static isChallengePage(html: string): boolean {
		const page = String(html || "");
		if (page.length > 40_000) return false; // a real results page is bigger than this
		return /anomaly-modal|challenge-form|unusual traffic|are you a robot|blocked for security/i.test(page);
	}

	/**
	 * Parse the result page.
	 *
	 * The markup is matched by class name, and the real link is unwrapped from the redirect
	 * the provider wraps every result in -- handing the model a `duckduckgo.com/l/?uddg=...`
	 * link would be useless to it and would hide where the link actually goes.
	 */
	static parseSearchResults(html: string): WebSearchResult[] {
		const results: WebSearchResult[] = [];
		const anchor = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

		for (const match of html.matchAll(anchor)) {
			if (results.length >= MAX_RESULTS) break;
			const target = DesktopWebService.unwrapRedirect(match[1]);
			if (!target) continue;
			results.push({
				title: DesktopWebService.stripTags(match[2]),
				url: target,
				snippet: "",
			});
		}

		// The snippets are in a second anchor per result, in the same order, so they are read
		// separately and paired by position. Missing a snippet is fine; inventing one is not.
		const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) =>
			DesktopWebService.stripTags(m[1]),
		);
		results.forEach((result, index) => {
			result.snippet = snippets[index] ?? "";
		});

		return results;
	}

	/** DuckDuckGo wraps each result's real link in a redirect; unwrap it. */
	static unwrapRedirect(href: string): string | null {
		let raw = String(href || "").trim();
		if (!raw) return null;
		if (raw.startsWith("//")) raw = `https:${raw}`;

		try {
			const parsed = new URL(raw);
			const wrapped = parsed.searchParams.get("uddg");
			if (wrapped) return wrapped;
			// A direct link is fine too, as long as it is http(s).
			return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
		} catch {
			return null;
		}
	}

	/**
	 * Fetch a page and return it as text.
	 *
	 * The text is truncated, because the point is to give the model a page to read, not to
	 * hand it a megabyte of markup.
	 */
	async fetchPage(url: string, limit = DEFAULT_FETCH_LIMIT): Promise<WebPage> {
		const target = String(url || "").trim();
		if (!target) {
			throw new BadRequestException({ error: "a url is required" });
		}

		await assertPublicWebUrl(target);

		const cap = Math.min(Math.max(1000, Number(limit) || DEFAULT_FETCH_LIMIT), MAX_FETCH_LIMIT);
		let current = target;

		for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
			const response = await fetchBounded(current, {
				method: "GET",
				timeoutMs: FETCH_TIMEOUT_MS,
				// The body is capped: a hostile page must not be able to flood the model, the
				// client or the ledger.
				maxBytes: 4_000_000,
				// Redirects are followed by hand, so each hop can be re-checked. Letting the
				// HTTP client follow the chain would let a public URL redirect into the
				// private network without ever being looked at -- and the default `fetch`
				// does exactly that.
				redirect: "manual",
				headers: { Accept: "text/html,application/xhtml+xml,text/plain" },
			});

			// `location` is a header, not a property of the response.
			const location = response.headers.get("location");
			if (response.status >= 300 && response.status < 400 && location) {
				current = new URL(location, current).toString();
				await assertPublicWebUrl(current);
				continue;
			}

			const html = await response.text();
			const text = DesktopWebService.htmlToText(html);
			return {
				url: target,
				finalUrl: current,
				title: DesktopWebService.extractTitle(html),
				text: text.slice(0, cap),
				truncated: text.length > cap,
			};
		}

		throw new BadRequestException({ error: "too many redirects" });
	}

	/** Remove markup, scripts and styles, and collapse whitespace. */
	static htmlToText(html: string): string {
		return String(html || "")
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'")
			.replace(/[ \t]+/g, " ")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}

	static extractTitle(html: string): string {
		const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ""));
		return match ? DesktopWebService.stripTags(match[1]) : "";
	}

	static stripTags(value: string): string {
		return String(value || "")
			.replace(/<[^>]+>/g, "")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'")
			.replace(/&nbsp;/gi, " ")
			.replace(/\s+/g, " ")
			.trim();
	}
}

/**
 * Refuse a URL that points inward.
 *
 * The allowlist in `egressPolicy` is about what a deployment *permits*; this is about what
 * must never be reachable at all, whether or not anybody configured an allowlist. A model
 * that reads a hostile page can be told to fetch anything, and `169.254.169.254` is a
 * meaningful address on a cloud host.
 */
export async function assertPublicWebUrl(target: string): Promise<void> {
	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw new BadRequestException({ error: "the url is not valid" });
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new BadRequestException({ error: "only http and https urls can be fetched" });
	}

	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host === "metadata.google.internal"
	) {
		throw new BadRequestException({ error: "that host is not reachable from the web tool" });
	}

	// A literal address, checked directly.
	if (isPrivateAddress(host)) {
		throw new BadRequestException({ error: "that address is not reachable from the web tool" });
	}

	// And a name that resolves to one, which is the same thing with more steps.
	let addresses: Array<{ address: string }> = [];
	try {
		addresses = await dns.lookup(host, { all: true });
	} catch {
		throw new BadRequestException({ error: "that host could not be resolved" });
	}
	if (!addresses.length) {
		throw new BadRequestException({ error: "that host could not be resolved" });
	}
	for (const entry of addresses) {
		if (isPrivateAddress(entry.address)) {
			throw new BadRequestException({ error: "that host resolves to a private address" });
		}
	}
}

/** Whether an address is one that must never be fetched from a user-facing tool. */
export function isPrivateAddress(address: string): boolean {
	const value = String(address || "").trim().toLowerCase();
	if (!value) return true;

	// IPv6, including the mapped and unique-local forms.
	if (value.includes(":")) {
		if (value === "::1" || value === "::") return true;
		if (value.startsWith("fc") || value.startsWith("fd")) return true; // unique local
		if (value.startsWith("fe80")) return true; // link local
		const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
		return mapped ? isPrivateAddress(mapped[1]) : false;
	}

	const parts = value.split(".");
	// Not a dotted quad at all: this is a hostname, and the question of whether it is private
	// is answered by resolving it, not by looking at the text.
	//
	// Treating an unrecognised name as private was the first version of this, and it refused
	// every hostname -- including `example.com`. The safe answer for a *name* is to resolve it
	// and look at where it points.
	if (parts.length !== 4) return false;

	// Four parts, but not four numbers: it was written to be an address and is not one.
	if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return true;

	const [a, b] = parts.map((part) => Number.parseInt(part, 10));
	if (a === 0 || a === 10 || a === 127) return true; // this network, loopback
	if (a === 169 && b === 254) return true; // link local, including cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // private
	if (a === 192 && b === 168) return true; // private
	if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
	if (a === 192 && b === 0) return true; // IETF protocol assignments
	if (a >= 224) return true; // multicast and reserved
	return false;
}
