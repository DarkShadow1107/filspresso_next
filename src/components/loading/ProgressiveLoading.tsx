"use client";

import { useProgressiveLoadState, type ProgressiveLoadVariant } from "@/hooks/useProgressiveLoadState";

type ProgressiveLoadingProps = {
	active: boolean;
	variant: ProgressiveLoadVariant;
	subjectLabel?: string;
};

function LoadingSpinner({ className = "" }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
		/>
	);
}

function SkeletonBlock({ className = "" }: { className?: string }) {
	return <div className={`animate-pulse rounded-2xl bg-white/10 ${className}`} />;
}

function ProductSkeletonCard() {
	return (
		<div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)] backdrop-blur-sm">
			<SkeletonBlock className="h-52 w-full rounded-[1.25rem]" />
			<div className="mt-4 space-y-3">
				<SkeletonBlock className="h-5 w-5/6" />
				<SkeletonBlock className="h-4 w-full" />
				<SkeletonBlock className="h-4 w-4/5" />
				<div className="flex items-center gap-2 pt-2">
					<SkeletonBlock className="h-8 w-24 rounded-full" />
					<SkeletonBlock className="h-8 w-28 rounded-full" />
				</div>
			</div>
		</div>
	);
}

function SectionSkeleton({ titleWidth = "w-40", cards = 4 }: { titleWidth?: string; cards?: number }) {
	return (
		<section className="space-y-6">
			<div className="flex items-center gap-4">
				<SkeletonBlock className={`h-8 ${titleWidth}`} />
				<div className="h-px flex-1 bg-white/10" />
			</div>
			<div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: cards }).map((_, index) => (
					<ProductSkeletonCard key={index} />
				))}
			</div>
		</section>
	);
}

function CoffeeSkeleton() {
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-[1720px] flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
			<SkeletonBlock className="h-[22rem] w-full rounded-[2rem]" />
			<div className="mx-auto w-full max-w-3xl rounded-full border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
				<div className="flex gap-3">
					{Array.from({ length: 3 }).map((_, index) => (
						<SkeletonBlock key={index} className="h-12 flex-1 rounded-full" />
					))}
				</div>
			</div>
			<SectionSkeleton titleWidth="w-48" cards={4} />
			<SectionSkeleton titleWidth="w-44" cards={4} />
			<SectionSkeleton titleWidth="w-56" cards={3} />
		</div>
	);
}

function MachineSkeleton() {
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-[1720px] flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
			<SkeletonBlock className="h-[22rem] w-full rounded-[2rem]" />
			<div className="mx-auto w-full max-w-2xl rounded-full border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
				<div className="flex gap-3">
					{Array.from({ length: 2 }).map((_, index) => (
						<SkeletonBlock key={index} className="h-12 flex-1 rounded-full" />
					))}
				</div>
			</div>
			<SectionSkeleton titleWidth="w-48" cards={3} />
			<SectionSkeleton titleWidth="w-44" cards={3} />
		</div>
	);
}

function AppSkeleton() {
	return (
		<div className="flex min-h-screen items-center justify-center px-6 py-12">
			<div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-black/60 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
				<div className="flex items-center gap-4">
					<LoadingSpinner className="h-5 w-5 text-[#C8977B]" />
					<div className="space-y-2">
						<SkeletonBlock className="h-6 w-44" />
						<SkeletonBlock className="h-4 w-72" />
					</div>
				</div>
				<div className="mt-6 space-y-3">
					<SkeletonBlock className="h-3 w-full rounded-full" />
					<SkeletonBlock className="h-3 w-5/6 rounded-full" />
				</div>
			</div>
		</div>
	);
}

export function ProgressiveLoading({ active, variant, subjectLabel }: ProgressiveLoadingProps) {
	const loadState = useProgressiveLoadState(active, variant, subjectLabel);

	if (loadState.phase === "idle") {
		return null;
	}

	return (
		<div
			aria-busy="true"
			aria-live="polite"
			className="fixed inset-0 z-90 overflow-y-auto bg-[#070707]/90 backdrop-blur-md"
		>
			{loadState.phase === "skeleton" ? (
				variant === "coffee" ? (
					<CoffeeSkeleton />
				) : variant === "machines" ? (
					<MachineSkeleton />
				) : (
					<AppSkeleton />
				)
			) : (
				<div className="flex min-h-screen items-center justify-center px-6 py-12">
					<div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-black/75 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
						<div className="flex items-center gap-4">
							<LoadingSpinner className="h-5 w-5 text-[#C8977B]" />
							<div>
								<p className="text-sm uppercase tracking-[0.28em] text-[#C8977B]">
									{variant === "coffee" ? "Brewing the coffee showcase" : variant === "machines" ? "Warming up the machines showcase" : "Loading Filspresso"}
								</p>
								<p className="mt-2 text-lg font-semibold text-white">{loadState.statusMessage}</p>
							</div>
						</div>
						<div className="mt-6 space-y-3">
							<div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
								<div
									className="h-full rounded-full bg-linear-to-r from-[#C8977B] via-[#f2d1bb] to-[#8f5f3e] transition-[width] duration-300 ease-out"
									style={{ width: `${loadState.progress}%` }}
								/>
							</div>
							<div className="flex items-center justify-between text-sm text-white/70">
								<span>{Math.round(loadState.progress)}%</span>
								<span>Almost there</span>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export function InlineLoadingSpinner({ className = "" }: { className?: string }) {
	return <LoadingSpinner className={className} />;
}