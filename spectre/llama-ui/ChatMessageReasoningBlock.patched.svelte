<script lang="ts">
	import { Lightbulb } from '@lucide/svelte';
	import { CollapsibleContentBlock, MarkdownContent } from '$lib/components/app';
	import { REASONING_SCROLL_AT_BOTTOM_THRESHOLD_PX } from '$lib/constants';
	import { AgenticSectionType } from '$lib/enums';
	import { settingsStore } from '$lib/stores';
	import type { AgenticSection, DatabaseMessageExtra } from '$lib/types';

	interface Props {
		section: AgenticSection;
		open: boolean;
		isStreaming: boolean;
		hasReasoningError?: boolean;
		attachments?: DatabaseMessageExtra[];
		thoughtNumber?: number;
		onToggle?: () => void;
	}

	let {
		attachments,
		hasReasoningError = false,
		isStreaming,
		onToggle,
		open,
		section,
		thoughtNumber
	}: Props = $props();

	const currentConfig = settingsStore.config;

	const REASONING_HEADER = 'Thought';
	const REASONING_HEADER_PENDING = 'Thinking...';

	const isPending = $derived(section.type === AgenticSectionType.REASONING_PENDING);
	const hasImage = $derived(Boolean(attachments && attachments.length > 0));
	const title = $derived.by(() => {
		// While generating: "Thinking...". When finished: "Thought" / "Thought N".
		if (isPending && isStreaming) return REASONING_HEADER_PENDING;
		return thoughtNumber ? `${REASONING_HEADER} ${thoughtNumber}` : REASONING_HEADER;
	});
	const subtitle = $derived.by(() => {
		if (isPending && !isStreaming) {
			return hasReasoningError ? 'Error' : 'Cancelled';
		}

		if (section.wasInterrupted) {
			return hasReasoningError ? 'Error' : 'Cancelled';
		}
		if (hasImage) return '📷';
		return isStreaming ? '' : undefined;
	});
	const shimmerTitle = $derived(isPending && isStreaming);

	let scrollEl: HTMLDivElement | undefined = $state();

	const SCROLL_BOTTOM_THRESHOLD_PX = REASONING_SCROLL_AT_BOTTOM_THRESHOLD_PX;

	let userScrolledUp = $state(false);
	let lastScrollTop = 0;
	let pendingFrame: number | null = null;

	function isAtBottom(): boolean {
		if (!scrollEl) return false;

		return (
			scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop <=
			SCROLL_BOTTOM_THRESHOLD_PX
		);
	}

	function scrollToBottomOnFrame() {
		if (pendingFrame !== null || !scrollEl || userScrolledUp) return;

		pendingFrame = requestAnimationFrame(() => {
			pendingFrame = null;

			// User may scroll between scheduling and paint.
			if (scrollEl && !userScrolledUp) {
				scrollEl.scrollTop = scrollEl.scrollHeight;
			}
		});
	}

	function handleScrollEvent() {
		if (!scrollEl) return;

		const isScrollingUp = scrollEl.scrollTop < lastScrollTop;

		if (isScrollingUp && !isAtBottom()) {
			userScrolledUp = true;
		} else if (isAtBottom()) {
			userScrolledUp = false;
		}

		lastScrollTop = scrollEl.scrollTop;
	}

	$effect(() => {
		void section.content;

		if (!scrollEl || !isPending || !isStreaming) return;

		scrollToBottomOnFrame();
	});

	$effect(() => {
		// Layout shifts that don't change section.content (markdown re-parse,
		// syntax-highlight settle, image loads).
		if (!scrollEl || !isPending || !isStreaming) return;

		const observer = new MutationObserver(() => scrollToBottomOnFrame());

		observer.observe(scrollEl, {
			characterData: true,
			childList: true,
			subtree: true
		});

		return () => observer.disconnect();
	});

	$effect(() => {
		// Pin to bottom at the start of each round.
		if (!isPending) {
			userScrolledUp = false;
			lastScrollTop = 0;
		}
	});
</script>

<CollapsibleContentBlock
	{open}
	class="my-2"
	icon={Lightbulb}
	iconClass="h-3.5 w-3.5"
	{title}
	{subtitle}
	{shimmerTitle}
	{onToggle}
>
	<div
		bind:this={scrollEl}
		class="reasoning-content"
		class:is-streaming={isPending}
		onscroll={handleScrollEvent}
	>
		{#if currentConfig.renderThinkingAsMarkdown}
			<MarkdownContent content={section.content} class="text-muted-foreground" {attachments} />
		{:else}
			<div
				class="text-[13px] leading-relaxed wrap-break-word whitespace-pre-wrap text-muted-foreground"
			>
				{section.content}
			</div>
		{/if}
	</div>
</CollapsibleContentBlock>
{#if hasImage && !open}
	<div class="reasoning-image-persist ml-6 mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
		<span class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">📷 image attached · Thought {thoughtNumber ?? ''} keeps image visible</span>
	</div>
{/if}

<style>
	.reasoning-content.is-streaming {
		max-height: 28rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		padding-right: 0.25rem;
	}
</style>
