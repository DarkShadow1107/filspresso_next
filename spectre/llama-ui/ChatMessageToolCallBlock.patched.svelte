<script lang="ts">
	import ChatMessageToolCallBlockDefault from './ChatMessageToolCallBlockDefault.svelte';
	import ChatMessageToolCallBlockEditFile from './ChatMessageToolCallBlockEditFile.svelte';
	import ChatMessageToolCallBlockExecShellCommand from './ChatMessageToolCallBlockExecShellCommand.svelte';
	import ChatMessageToolCallBlockFileGlobSearch from './ChatMessageToolCallBlockFileGlobSearch.svelte';
	import ChatMessageToolCallBlockGetDatetime from './ChatMessageToolCallBlockGetDatetime.svelte';
	import ChatMessageToolCallBlockGetInfo from './ChatMessageToolCallBlockGetInfo.svelte';
	import ChatMessageToolCallBlockGrepSearch from './ChatMessageToolCallBlockGrepSearch.svelte';
	import ChatMessageToolCallBlockReadFile from './ChatMessageToolCallBlockReadFile.svelte';
	import ChatMessageToolCallBlockReadMedia from './ChatMessageToolCallBlockReadMedia.svelte';
	import ChatMessageToolCallBlockRunJavascript from './ChatMessageToolCallBlockRunJavascript.svelte';
	import ChatMessageToolCallBlockRunPython from './ChatMessageToolCallBlockRunPython.svelte';
	import ChatMessageToolCallBlockSearchResults from './ChatMessageToolCallBlockSearchResults.svelte';
	import ChatMessageToolCallBlockWriteFile from './ChatMessageToolCallBlockWriteFile.svelte';
	import ToolCallBlock from './ToolCallBlock.svelte';
	import { AlertTriangle } from '@lucide/svelte';
	import { BuiltInTool } from '$lib/enums';
	import type { AgenticSection, DatabaseMessageExtra } from '$lib/types';
	import { extractSearchQuery, extractSearchResults, isWebSearchToolName } from '$lib/utils';

	interface Props {
		section: AgenticSection;
		attachments?: DatabaseMessageExtra[];
		open: boolean;
		isStreaming: boolean;
		isExecuting?: boolean;
		onToggle?: () => void;
	}

	let { attachments, isExecuting, isStreaming, onToggle, open, section }: Props = $props();

	const searchResults = $derived(extractSearchResults(section.toolResult));
	const searchQuery = $derived(extractSearchQuery(section.toolArgs));
	const isSearchCall = $derived(
		searchResults.length > 0 || (searchQuery.length > 0 && isWebSearchToolName(section.toolName))
	);

	// Custom routing for CodeSentry tools to match requested formatting (Images 2-4)
	// - execute_terminal -> Execute Terminal (CollapsibleTerminalBlock) like Image2
	// - run_python -> Execute Python code (RunJavascript block) like Image4
	// - repository_run with C++/terminal -> Execute Terminal
	const isExecuteTerminal = $derived(
		section.toolName === "execute_terminal" ||
		(section.toolName === "repository_run" && /compile|cpp|terminal/i.test(JSON.stringify(section.toolArgs || ""))) ||
		section.toolName === BuiltInTool.SERVER_EXEC_SHELL_COMMAND
	);
	const isRunPython = $derived(section.toolName === "run_python");
	const isCloneRepo = $derived(section.toolName === "clone_repository");

	// Clone args: {url} — shown live in the title like an engineer typing git.
	const cloneUrl = $derived.by(() => {
		try {
			const parsed = JSON.parse(section.toolArgs ?? '{}') as Record<string, unknown>;
			return typeof parsed.url === 'string' ? parsed.url : '';
		} catch {
			return '';
		}
	});

	// Clone result: {transcript: string[]} — rendered as terminal lines.
	const cloneLines: string[] = $derived.by(() => {
		if (!section.toolResult) return [];
		try {
			const parsed = JSON.parse(section.toolResult) as Record<string, unknown>;
			const transcript = (parsed as { transcript?: unknown }).transcript;
			if (Array.isArray(transcript)) {
				return transcript.filter((l): l is string => typeof l === 'string').slice(-30);
			}
		} catch {
			// fall through to raw text
		}
		return String(section.toolResult).split(/\r?\n/).filter(Boolean).slice(-30);
	});
</script>

{#if isSearchCall}
	<ChatMessageToolCallBlockSearchResults {section} {open} {isStreaming} {onToggle} />
{:else if isCloneRepo}
	<!-- Engineer-style: git clone command in the title, live transcript as terminal output -->
	<ToolCallBlock {section} {open} {isStreaming} meta={null} title="Clone Repository" {onToggle}>
		{#snippet titleSnippet()}
			<span class="font-mono">git clone {cloneUrl || '…'}</span>
		{/snippet}
		{#snippet children(_meta, ctx)}
			{#if ctx.isPending}
				<div class="flex items-start gap-2 text-xs text-muted-foreground/70">
					<span class="font-mono">ubuntu@sandbox:~$ git clone {cloneUrl || '…'} --depth 1</span>
				</div>
			{:else if cloneLines.length > 0}
				<div class="overflow-auto">
					<div class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">ubuntu@sandbox:~$ git clone {cloneUrl} --depth 1</div>
					{#each cloneLines as line, i (i)}
						<div class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{line}</div>
					{/each}
				</div>
			{:else}
				<div class="flex items-start gap-2 text-xs text-red-600 italic dark:text-red-400">
					<AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" />
					<span>No clone output</span>
				</div>
			{/if}
		{/snippet}
	</ToolCallBlock>
{:else if isExecuteTerminal}
	<!-- Like Image2: Kimi's Computer → Execute Terminal → Terminal dark block with ubuntu@sandbox -->
	<ChatMessageToolCallBlockExecShellCommand
		{section}
		{open}
		{isStreaming}
		{isExecuting}
		{attachments}
		{onToggle}
	/>
{:else if isRunPython}
	<!-- Execute Python code → Request (highlighted) + Console (ubuntu@sandbox + output) -->
	<ChatMessageToolCallBlockRunPython {section} {open} {isStreaming} {onToggle} />
{:else if section.toolName === BuiltInTool.BROWSER_GET_DATETIME}
	<ChatMessageToolCallBlockGetDatetime {section} {isStreaming} />
{:else if section.toolName === BuiltInTool.SERVER_GET_INFO}
	<ChatMessageToolCallBlockGetInfo {section} {isStreaming} />
{:else if section.toolName === BuiltInTool.SERVER_READ_FILE}
	<ChatMessageToolCallBlockReadFile {section} {open} {isStreaming} {onToggle} />
{:else if section.toolName === BuiltInTool.BROWSER_READ_MEDIA}
	<ChatMessageToolCallBlockReadMedia {section} {open} {isStreaming} {onToggle} />
{:else if section.toolName === BuiltInTool.SERVER_EDIT_FILE}
	<ChatMessageToolCallBlockEditFile {section} {open} {isStreaming} {onToggle} />
{:else if section.toolName === BuiltInTool.SERVER_WRITE_FILE}
	<ChatMessageToolCallBlockWriteFile {section} {open} {isStreaming} {onToggle} />
{:else if section.toolName === BuiltInTool.SERVER_FILE_GLOB_SEARCH}
	<ChatMessageToolCallBlockFileGlobSearch {section} {open} {isStreaming} {onToggle} />
{:else if section.toolName === BuiltInTool.SERVER_GREP_SEARCH}
	<ChatMessageToolCallBlockGrepSearch {section} {open} {isStreaming} {onToggle} />
{:else if section.toolName === BuiltInTool.BROWSER_RUN_JAVASCRIPT}
	<ChatMessageToolCallBlockRunJavascript {section} {open} {isStreaming} {onToggle} />
{:else}
	<!-- Default for repository_* etc. – shows Input/Output with SyntaxHighlightedCode like Image3 Dockerfile -->
	<ChatMessageToolCallBlockDefault {section} {open} {isStreaming} {attachments} {onToggle} />
{/if}
