export const PAGE_SLUGS = [
	"home",
	"account",
	"coffee",
	"coffee-machine-animation",
	"love-coffee",
	"machines",
	"payment",
	"shopping-bag",
	"subscription",
] as const;

export type PageSlug = (typeof PAGE_SLUGS)[number];

export const DEFAULT_PAGE_SLUG: PageSlug = "home";

export function isPageSlug(value: unknown): value is PageSlug {
	return typeof value === "string" && (PAGE_SLUGS as readonly string[]).includes(value);
}

export function buildPageHref(slug: PageSlug) {
	if (slug === DEFAULT_PAGE_SLUG) {
		return "/";
	}

	return `/?page=${encodeURIComponent(slug)}`;
}
