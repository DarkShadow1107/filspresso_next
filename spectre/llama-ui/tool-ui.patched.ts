import { TOOL_UI } from '$lib/constants';
import type { ToolUiEntry } from '$lib/types';

/**
 * Friendly labels for CodeSentry MCP tools so chat shows
 * "CVE Search", "Clone Repository", "Execute Terminal" — never raw
 * snake_case names and never a "Tools" prefix.
 */
const FRIENDLY_LABELS: Record<string, string> = {
	research_web: 'Research Web',
	fetch_pages: 'Fetch Pages',
	knowledge_search: 'Knowledge Search',
	knowledge_save: 'Save Knowledge',
	cve_search: 'CVE Search',
	create_document: 'Create Document',
	modify_document: 'Modify Document',
	list_documents: 'List Documents',
	run_python: 'Run Python',
	execute_terminal: 'Execute Terminal',
	clone_repository: 'Clone Repository',
	understand_image: 'Understand Image',
	analyze_repository: 'Analyze Repository',
	repository_context: 'Repository Context',
	repository_list_files: 'List Repo Files',
	repository_read_file: 'Read Repo File',
	repository_search: 'Search Repo',
	repository_scan: 'Scan Repository',
	repository_run: 'Run Repo Checks',
	dependency_audit: 'Dependency Audit',
	calculate: 'Calculator'
};

function prettify(toolName: string): string {
	return toolName
		.replace(/^Tools_/i, '')
		.replaceAll('_', ' ')
		.replace(/(^| )([a-z])/gi, (_m, prefix: string, char: string) => prefix + char.toUpperCase())
		.replace(/\bCve\b/g, 'CVE');
}

/**
 * Resolve the UI metadata (label + icon) for a server or browser tool by its
 * name. Falls back to a prettified label for CodeSentry MCP tools so callers
 * render a friendly title instead of the raw function name.
 */
export function getToolUi(toolName: string | undefined): ToolUiEntry | null {
	if (!toolName) return null;

	const known = (TOOL_UI as Record<string, ToolUiEntry>)[toolName];
	if (known) return known;

	return {
		label: FRIENDLY_LABELS[toolName] ?? prettify(toolName)
	} as unknown as ToolUiEntry;
}
