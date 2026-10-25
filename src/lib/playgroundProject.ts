import { isReviewWorkspacePath } from "./playgroundAgentReview";

export const PROJECT_LIMITS = Object.freeze({ files: 256, fileBytes: 262_144, totalBytes: 8_388_608 });
export type ProjectFile = Readonly<{ path: string; text: string }>;
export type ProjectArtifact = Readonly<{ version: 1; kind: "filspresso-text-project"; files: readonly (ProjectFile & { bytes: number; sha256: string })[]; totalBytes: number }>;
const utf8 = new TextEncoder();

/** Portable, client-local text project only. Never an executable archive or permission. */
export function validateProject(files: readonly ProjectFile[]): readonly ProjectFile[] {
	if (files.length > PROJECT_LIMITS.files) throw new Error("Project exceeds 256 files.");
	const seen = new Set<string>(); let total = 0;
	const result = files.map(file => {
		if (!file || !isReviewWorkspacePath(file.path) || file.path.split("/").length > 16 || typeof file.text !== "string" ||
			file.text.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(file.text)) throw new Error("Project contains an invalid path or non-text file.");
		const key = file.path.toLowerCase();
		if (seen.has(key) || [...seen].some(other => other.startsWith(key + "/") || key.startsWith(other + "/"))) throw new Error("Project contains duplicate paths or file/directory aliases.");
		seen.add(key); const bytes = utf8.encode(file.text).length; total += bytes;
		if (bytes > PROJECT_LIMITS.fileBytes || total > PROJECT_LIMITS.totalBytes) throw new Error("Project exceeds the 256 KiB/file or 8 MiB total byte limit.");
		return Object.freeze({ path: file.path, text: file.text });
	});
	return Object.freeze(result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function createProjectArtifact(input: readonly ProjectFile[]): Promise<ProjectArtifact> {
	const source = validateProject(input); const files: Array<ProjectFile & { bytes: number; sha256: string }> = [];
	for (const file of source) {
		const bytes = utf8.encode(file.text);
		const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), item => item.toString(16).padStart(2, "0")).join("");
		files.push(Object.freeze({ ...file, bytes: bytes.length, sha256 }));
	}
	return Object.freeze({ version: 1, kind: "filspresso-text-project", files: Object.freeze(files), totalBytes: files.reduce((total, file) => total + file.bytes, 0) });
}

export function projectChanges(before: readonly ProjectFile[], after: readonly ProjectFile[]) {
	const old = new Map(validateProject(before).map(file => [file.path, file.text]));
	const next = new Map(validateProject(after).map(file => [file.path, file.text]));
	return [...new Set([...old.keys(), ...next.keys()])].sort().filter(path => old.get(path) !== next.get(path)).map(path =>
		Object.freeze({ path, before: old.get(path), after: next.get(path), kind: !old.has(path) ? "added" : !next.has(path) ? "deleted" : "modified" }));
}

/** Non-executing SOURCE preview. Never interprets project HTML/JS/CSS, opens URLs or
 * starts a web server. A live application preview needs a separate qualified origin. */
export function inertSourcePreview(text: string): string {
	if (utf8.encode(text).length > PROJECT_LIMITS.fileBytes) throw new Error("Preview exceeds 256 KiB.");
	const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
	return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'; sandbox"><title>Inert source preview</title><pre>' + escaped + "</pre>";
}
