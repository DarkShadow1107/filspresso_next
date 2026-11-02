/** Local convenience policy, never a replacement for server authorization or sandbox gates. */
export const WEB_AGENT_TOOLS = ["list_files", "read_file", "write_file", "list_documents", "read_document", "save_document", "delete_document", "server_date", "web_search", "research_web", "fetch_page"] as const;
export type WebAgentTool = typeof WEB_AGENT_TOOLS[number];
export type ToolPermission = "allow" | "ask" | "deny";
export type ToolPermissions = Record<WebAgentTool, ToolPermission>;

export const DEFAULT_TOOL_PERMISSIONS: Readonly<ToolPermissions> = Object.freeze({
	list_files: "allow", read_file: "allow", list_documents: "allow", read_document: "allow",
	write_file: "ask", save_document: "ask", delete_document: "ask", server_date: "allow", web_search: "allow", research_web: "allow", fetch_page: "allow",
});

/** Unknown tools are always denied, and malformed stored preferences revert to defaults. */
export function normalizeToolPermissions(value: unknown): ToolPermissions {
	const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
	return Object.fromEntries(WEB_AGENT_TOOLS.map(name => {
		const permission = Object.hasOwn(source, name) ? source[name] : undefined;
		return [name, permission === "allow" || permission === "ask" || permission === "deny" ? permission : DEFAULT_TOOL_PERMISSIONS[name]];
	})) as ToolPermissions;
}

export function permissionForTool(permissions: ToolPermissions, name: string): ToolPermission {
	return (WEB_AGENT_TOOLS as readonly string[]).includes(name) ? permissions[name as WebAgentTool] : "deny";
}
