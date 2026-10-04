<script lang="ts">
	// Block for the CodeSentry `run_python` MCP tool. Mirrors the
	// `RunJavascript` look (Request code + Console output) but parses our own
	// tool name/args directly, since the builtin parser only accepts
	// `browser_run_javascript` (which rendered our calls as an empty block).
	// Result shape comes from /api/code/run:
	// {ok, result, stdout, stderr, command?} or plain error text.

	import ToolCallBlock from './ToolCallBlock.svelte';
	import { Terminal, XCircle } from '@lucide/svelte';
	import { SyntaxHighlightedCode } from '$lib/components/app';
	import { MAX_HEIGHT_CODE_BLOCK } from '$lib/constants';
	import { FileTypeText } from '$lib/enums';
	import type { AgenticSection } from '$lib/types';
	import { getToolUi } from '$lib/utils';

	interface Props {
		section: AgenticSection;
		open: boolean;
		isStreaming: boolean;
		onToggle?: () => void;
	}

	let { isStreaming, onToggle, open, section }: Props = $props();

	const title = $derived(getToolUi(section.toolName)?.label ?? 'Run Python');

	const code = $derived.by(() => {
		if (!section.toolArgs) return '';
		try {
			const parsed = JSON.parse(section.toolArgs) as Record<string, unknown>;
			return typeof parsed.code === 'string' ? parsed.code : '';
		} catch {
			return '';
		}
	});

	const parsedResult: Record<string, unknown> | null = $derived.by(() => {
		if (!section.toolResult) return null;
		try {
			const parsed: unknown = JSON.parse(section.toolResult);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// fall through to raw text
		}
		return null;
	});

	const outputText = $derived.by(() => {
		if (!section.toolResult) return '';
		if (parsedResult) {
			const stdout = typeof parsedResult.stdout === 'string' ? parsedResult.stdout : '';
			const stderr = typeof parsedResult.stderr === 'string' ? parsedResult.stderr : '';
			const combined = [stdout, stderr].filter((part) => part.trim()).join('\n');
			if (combined.trim()) return combined;
			if (parsedResult.result != null) {
				try {
					return JSON.stringify(parsedResult.result, null, 2);
				} catch {
					return String(parsedResult.result);
				}
			}
			return '';
		}
		return section.toolResult;
	});

	const isError = $derived.by(() => {
		if (!section.toolResult) return false;
		if (parsedResult) return parsedResult.ok === false;
		return /^(Tool request failed|Error:)/i.test(section.toolResult.trim());
	});

	const runCommand = $derived(
		parsedResult && typeof parsedResult.command === 'string' && parsedResult.command
			? parsedResult.command
			: 'python -I task.py'
	);
</script>

<ToolCallBlock
	{section}
	{open}
	{isStreaming}
	meta={isError ? { errorMessage: outputText.slice(0, 500) } : null}
	{title}
	{onToggle}
>
	{#snippet children(_meta, ctx)}
		{#if code}
			<div class="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground/70">
				<span>Request</span>
			</div>
			<SyntaxHighlightedCode
				code={code}
				language={FileTypeText.PYTHON}
				maxHeight={MAX_HEIGHT_CODE_BLOCK}
				streaming={ctx.isCodeStreaming}
			/>
			<div class="mb-2 mt-3 flex items-center gap-2 text-xs text-muted-foreground/70">
				<Terminal class="h-3 w-3" />
				<span>Console</span>
				<span class="font-mono">ubuntu@sandbox:~$ {runCommand}</span>
			</div>
			{#if ctx.isPending && !outputText}
				<div class="rounded bg-muted/20 p-2 font-mono text-[11px] text-muted-foreground/70 italic">
					Running {runCommand}...
				</div>
			{:else if outputText}
				<div class="overflow-auto">
					{#each outputText.split('\n') as line, i (i)}
						<div class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{line}</div>
					{/each}
				</div>
			{:else}
				<div class="rounded bg-muted/20 p-2 text-xs text-muted-foreground/70 italic">No output</div>
			{/if}
		{:else if ctx.isPending}
			<div class="rounded bg-muted/20 p-2 text-xs text-muted-foreground/70 italic">
				Receiving script...
			</div>
		{:else if isError}
			<div
				class="flex items-start gap-2 rounded bg-red-500/10 p-2 text-xs text-red-600 italic dark:text-red-400"
			>
				<XCircle class="mt-0.5 h-3 w-3 shrink-0" />
				<span>{outputText || 'Run failed'}</span>
			</div>
		{:else}
			<div class="rounded bg-muted/20 p-2 text-xs text-muted-foreground/70 italic">No output</div>
		{/if}
	{/snippet}
</ToolCallBlock>
