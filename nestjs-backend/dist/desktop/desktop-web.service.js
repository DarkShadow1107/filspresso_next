"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var DesktopWebService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopWebService = void 0;
exports.assertPublicWebUrl = assertPublicWebUrl;
exports.isPrivateAddress = isPrivateAddress;
const common_1 = require("@nestjs/common");
const dns = __importStar(require("dns/promises"));
const egressPolicy_1 = require("../common/utils/egressPolicy");
const httpClient_1 = require("../common/utils/httpClient");
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
const MAX_QUERY_LENGTH = 512;
const MAX_RESULTS = 10;
const DEFAULT_FETCH_LIMIT = 20_000;
const MAX_FETCH_LIMIT = 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
let DesktopWebService = DesktopWebService_1 = class DesktopWebService {
    /**
     * Search the web.
     *
     * Scrapling, against DuckDuckGo and Google.
     *
     * The scraping happens in the AI service, because Scrapling is a Python library and because
     * its adaptive element selection is the part worth having: a provider changes a class name
     * and the selector is re-resolved against the page rather than silently matching nothing.
     *
     * Both providers are scraped, so both rate-limit and both answer a block rather than
     * results when they are refusing. That is reported as a block, because an empty result
     * list would tell the model the web had nothing to say, and the model would answer from its
     * own memory instead.
     *
     * The *fetch* of a model-supplied url is not done here and is not done by the AI service
     * either: it is done by this class, because that is where the fence lives.
     */
    async search(query, limit = MAX_RESULTS) {
        const text = String(query || "").trim();
        if (!text) {
            throw new common_1.BadRequestException({ error: "a query is required" });
        }
        if (text.length > MAX_QUERY_LENGTH) {
            throw new common_1.BadRequestException({ error: `the query may be at most ${MAX_QUERY_LENGTH} characters` });
        }
        // The search itself is scraped by the AI service, with Scrapling.
        //
        // Scrapling is a Python library, so the scraping cannot happen here, and putting it
        // there would mean either a second scraper in Node or a call out to the AI service
        // anyway. The AI service already speaks HTTP to everything else, and the parsing is
        // where Scrapling earns its place: its selectors adapt when a provider changes its
        // markup, where a regular expression would silently match nothing.
        //
        // The providers are DuckDuckGo and Google. Both are scraped, both rate-limit, and
        // both answer with a block rather than with results when they are refusing. That is
        // reported as a block, because an empty list would tell the model the web had nothing
        // to say.
        const url = `${this.aiHost()}/api/web/search?q=${encodeURIComponent(text)}&limit=${limit}`;
        (0, egressPolicy_1.assertAllowedEgress)(url, "web search");
        const response = await (0, httpClient_1.fetchBounded)(url, {
            method: "GET",
            timeoutMs: SEARCH_TIMEOUT_MS,
            maxBytes: 1_000_000,
            headers: { Accept: "application/json" },
        });
        if (response.status === 503) {
            const body = await response.json().catch(() => ({}));
            throw new common_1.ServiceUnavailableException({
                error: "SEARCH_PROVIDER_BUSY",
                message: body.error ?? "The search providers are refusing this address right now.",
            });
        }
        if (!response.ok) {
            throw new common_1.ServiceUnavailableException({
                error: "SEARCH_PROVIDER_BUSY",
                message: "The search could not be run. Try again shortly.",
            });
        }
        const body = await response.json().catch(() => ({}));
        return (body.results ?? []).map((result) => ({
            title: String(result.title ?? ""),
            url: String(result.url ?? ""),
            snippet: String(result.snippet ?? ""),
        }));
    }
    /** Where the AI service is. The same name the Next route uses. */
    aiHost() {
        const configured = String(process.env.PYTHON_AI_HOST || "").trim();
        return (configured || "http://ai:5000").replace(/\/+$/, "");
    }
    /**
     * Fetch a page and return it as text.
     *
     * The text is truncated, because the point is to give the model a page to read, not to
     * hand it a megabyte of markup.
     */
    async fetchPage(url, limit = DEFAULT_FETCH_LIMIT) {
        const target = String(url || "").trim();
        if (!target) {
            throw new common_1.BadRequestException({ error: "a url is required" });
        }
        await assertPublicWebUrl(target);
        const cap = Math.min(Math.max(1000, Number(limit) || DEFAULT_FETCH_LIMIT), MAX_FETCH_LIMIT);
        let current = target;
        for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
            const response = await (0, httpClient_1.fetchBounded)(current, {
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
            const text = DesktopWebService_1.htmlToText(html);
            return {
                url: target,
                finalUrl: current,
                title: DesktopWebService_1.extractTitle(html),
                text: text.slice(0, cap),
                truncated: text.length > cap,
            };
        }
        throw new common_1.BadRequestException({ error: "too many redirects" });
    }
    /** Remove markup, scripts and styles, and collapse whitespace. */
    static htmlToText(html) {
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
    static extractTitle(html) {
        const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ""));
        return match ? DesktopWebService_1.stripTags(match[1]) : "";
    }
    static stripTags(value) {
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
};
exports.DesktopWebService = DesktopWebService;
exports.DesktopWebService = DesktopWebService = DesktopWebService_1 = __decorate([
    (0, common_1.Injectable)()
], DesktopWebService);
/**
 * Refuse a URL that points inward.
 *
 * The allowlist in `egressPolicy` is about what a deployment *permits*; this is about what
 * must never be reachable at all, whether or not anybody configured an allowlist. A model
 * that reads a hostile page can be told to fetch anything, and `169.254.169.254` is a
 * meaningful address on a cloud host.
 */
async function assertPublicWebUrl(target) {
    let parsed;
    try {
        parsed = new URL(target);
    }
    catch {
        throw new common_1.BadRequestException({ error: "the url is not valid" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new common_1.BadRequestException({ error: "only http and https urls can be fetched" });
    }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host === "metadata.google.internal") {
        throw new common_1.BadRequestException({ error: "that host is not reachable from the web tool" });
    }
    // A literal address, checked directly.
    if (isPrivateAddress(host)) {
        throw new common_1.BadRequestException({ error: "that address is not reachable from the web tool" });
    }
    // And a name that resolves to one, which is the same thing with more steps.
    let addresses = [];
    try {
        addresses = await dns.lookup(host, { all: true });
    }
    catch {
        throw new common_1.BadRequestException({ error: "that host could not be resolved" });
    }
    if (!addresses.length) {
        throw new common_1.BadRequestException({ error: "that host could not be resolved" });
    }
    for (const entry of addresses) {
        if (isPrivateAddress(entry.address)) {
            throw new common_1.BadRequestException({ error: "that host resolves to a private address" });
        }
    }
}
/** Whether an address is one that must never be fetched from a user-facing tool. */
function isPrivateAddress(address) {
    const value = String(address || "").trim().toLowerCase();
    if (!value)
        return true;
    // IPv6, including the mapped and unique-local forms.
    if (value.includes(":")) {
        if (value === "::1" || value === "::")
            return true;
        if (value.startsWith("fc") || value.startsWith("fd"))
            return true; // unique local
        if (value.startsWith("fe80"))
            return true; // link local
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
    if (parts.length !== 4)
        return false;
    // Four parts, but not four numbers: it was written to be an address and is not one.
    if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255))
        return true;
    const [a, b] = parts.map((part) => Number.parseInt(part, 10));
    if (a === 0 || a === 10 || a === 127)
        return true; // this network, loopback
    if (a === 169 && b === 254)
        return true; // link local, including cloud metadata
    if (a === 172 && b >= 16 && b <= 31)
        return true; // private
    if (a === 192 && b === 168)
        return true; // private
    if (a === 100 && b >= 64 && b <= 127)
        return true; // carrier grade NAT
    if (a === 192 && b === 0)
        return true; // IETF protocol assignments
    if (a >= 224)
        return true; // multicast and reserved
    return false;
}
