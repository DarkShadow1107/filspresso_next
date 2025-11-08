import type { ComponentType } from "react";
import { notFound } from "next/navigation";
import { DEFAULT_PAGE_SLUG, type PageSlug, isPageSlug } from "@/lib/pages";
import type { Metadata } from "next";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

type PageProps = {
	searchParams?: SearchParamsRecord | Promise<SearchParamsRecord>;
};

function isPromise<T>(value: unknown): value is Promise<T> {
	return typeof value === "object" && value !== null && typeof (value as Promise<T>).then === "function";
}

const pageTitles: Record<PageSlug, string> = {
	home: "Filspresso",
	"love-coffee": "Filspresso - For The Love Of Coffee",
	coffee: "Filspresso - Coffee",
	machines: "Filspresso - Machines",
	subscription: "Filspresso - Subscription",
	"shopping-bag": "Filspresso - Bag",
	account: "Filspresso - Account",
	payment: "Filspresso - Card Payment",
	"coffee-machine-animation": "Filspresso - Coffee Machine Animation",
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
	const resolvedSearchParams = searchParams
		? isPromise<SearchParamsRecord>(searchParams)
			? await searchParams
			: searchParams
		: {};

	const rawSlug = resolvedSearchParams.page;
	const slugValue = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
	const normalized = slugValue?.trim();
	const slug: PageSlug = normalized && isPageSlug(normalized) ? normalized : DEFAULT_PAGE_SLUG;

	return {
		title: pageTitles[slug] || "Filspresso",
	};
}

const pageLoaders: Record<PageSlug, () => Promise<{ default: ComponentType }>> = {
	home: () => import("@/app/api/pages/home/page"),
	account: () => import("@/app/api/pages/account/page"),
	coffee: () => import("@/app/api/pages/coffee/page"),
	"coffee-machine-animation": () => import("@/app/api/pages/coffee-machine-animation/page"),
	"love-coffee": () => import("@/app/api/pages/love-coffee/page"),
	machines: () => import("@/app/api/pages/machines/page"),
	payment: () => import("@/app/api/pages/payment/page"),
	"shopping-bag": () => import("@/app/api/pages/shopping-bag/page"),
	subscription: () => import("@/app/api/pages/subscription/page"),
};

export default async function Page({ searchParams }: PageProps) {
	const resolvedSearchParams = searchParams
		? isPromise<SearchParamsRecord>(searchParams)
			? await searchParams
			: searchParams
		: {};

	const rawSlug = resolvedSearchParams.page;
	const slugValue = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
	const normalized = slugValue?.trim();
	const slug: PageSlug = normalized && isPageSlug(normalized) ? normalized : DEFAULT_PAGE_SLUG;

	if (!isPageSlug(slug)) {
		notFound();
	}

	const PageComponent = (await pageLoaders[slug]()).default;
	// Add key to force remount when page changes to prevent stale content
	return <PageComponent key={slug} />;
}
