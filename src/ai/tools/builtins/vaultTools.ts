/**
 * Built-in `vault` tools for the AI Agent (#714).
 *
 * Read tools (read_note/list_notes/search_notes/get_property_values) are readOnly
 * and auto-run (capped to bound cost/exfiltration). Write tools (create_note/
 * append_to_note/insert_under_heading) ship needsApproval:true, run every model-
 * chosen path through sanitizeVaultPath (every-segment dot floor, etc.) + the
 * runtime symlink/realpath guard, are existence-aware (create fails on exist; append/
 * insert require the file), and are frontmatter-aware (insertAtNoteBodyStart). The
 * high-risk trio run_choice/apply_template/set_frontmatter is deliberately NOT shipped.
 */
import { type App, TFile } from "obsidian";
import { getMarkdownFilesInFolder } from "../../../utilityObsidian";
import { insertAtNoteBodyStart } from "../../../utils/noteContentInsertion";
import { isWithinAllowedRoots } from "../allowedRoots";
import { sanitizeVaultPath } from "../sanitizeVaultPath";
import { assertWriteStaysInVault } from "../../../utils/vaultWriteGuards";
import type { JSONSchema } from "../NormalizedTools";
import type { QATool } from "../aiToolTypes";
import { applyGroupOptions, type BuiltinGroupOptions, type ToolSetMap } from "./shared";

const MAX_READ_CHARS = 16_000;
const DEFAULT_LIST = 100;
const MAX_LIST = 200;
const DEFAULT_SEARCH = 25;
const MAX_SEARCH = 50;
const MAX_SEARCH_FILE_SCAN = 400;

export function createVaultTools(
	app: App,
	options: BuiltinGroupOptions = {},
): ToolSetMap {
	const roots = options.allowedRoots;
	// The read tools below confine results to the allowedRoots fence by filtering each
	// app-owned TFile.path through isWithinAllowedRoots — the SAME identity-preserving
	// predicate the workspace group uses (#1432). A TFile.path is an identity, so it is
	// compared NFC-only and never trimmed/re-spelled; that is what stops a sibling folder
	// named " AI" from masquerading as the allowed root "AI". sanitizeVaultPath is kept
	// only for MODEL-CHOSEN inputs (read_note's path and the folder args), where trimming
	// and structural validation are correct. Absent/all-blank roots ⇒ vault-wide.

	const tools: ToolSetMap = {
		read_note: tool({
			description: "Read a note's full markdown content by vault path.",
			inputSchema: obj({ path: str("Vault path to the note, e.g. Notes/Foo.md") }, ["path"]),
			readOnly: true,
			execute: async ({ path }) => {
				const norm = sanitizeVaultPath(String(path), { allowedRoots: roots });
				const file = app.vault.getAbstractFileByPath(norm);
				if (!(file instanceof TFile)) return { found: false, path: norm };
				const content = await app.vault.cachedRead(file);
				return {
					found: true,
					path: norm,
					content:
						content.length > MAX_READ_CHARS
							? content.slice(0, MAX_READ_CHARS) + "\n…[truncated]"
							: content,
				};
			},
		}),

		list_notes: tool({
			description: "List markdown notes, optionally within a folder.",
			inputSchema: obj(
				{
					folder: str("Folder to list (omit for the whole vault)."),
					limit: int("Max results (default 100, capped at 200)."),
				},
				[],
			),
			readOnly: true,
			execute: async ({ folder, limit }) => {
				const base = folder ? sanitizeVaultPath(String(folder), { allowedRoots: roots }) : "";
				const cap = clamp(toInt(limit, DEFAULT_LIST), 1, MAX_LIST);
				const files = getMarkdownFilesInFolder(app, base).filter((f) =>
					isWithinAllowedRoots(f.path, roots),
				);
				return {
					total: files.length,
					notes: files.slice(0, cap).map((f) => ({ path: f.path, basename: f.basename })),
				};
			},
		}),

		search_notes: tool({
			description:
				"Search notes by name and/or content. Returns matching paths with a short snippet.",
			inputSchema: obj(
				{
					query: str("Text to search for."),
					in: enumStr(["name", "content", "both"], "Where to search (default both)."),
					limit: int("Max results (default 25, capped at 50)."),
				},
				["query"],
			),
			readOnly: true,
			execute: async ({ query, in: where, limit }) => {
				const q = String(query).toLowerCase();
				const scope = (where as string) ?? "both";
				const cap = clamp(toInt(limit, DEFAULT_SEARCH), 1, MAX_SEARCH);
				const files = app.vault
					.getMarkdownFiles()
					.filter((f) => isWithinAllowedRoots(f.path, roots));
				const results: Array<{ path: string; snippet?: string }> = [];
				let scanned = 0;
				for (const f of files) {
					if (results.length >= cap) break;
					const nameHit = scope !== "content" && f.basename.toLowerCase().includes(q);
					if (nameHit) {
						results.push({ path: f.path });
						continue;
					}
					if (scope !== "name" && scanned < MAX_SEARCH_FILE_SCAN) {
						scanned++;
						const text = await app.vault.cachedRead(f);
						const idx = text.toLowerCase().indexOf(q);
						if (idx >= 0) {
							results.push({ path: f.path, snippet: snippetAround(text, idx) });
						}
					}
				}
				return { results, scannedFiles: scanned, truncated: results.length >= cap };
			},
		}),

		get_property_values: tool({
			description:
				"List the distinct values a frontmatter property takes across the vault (e.g. existing tags or statuses).",
			inputSchema: obj(
				{ field: str("Frontmatter property name."), folder: str("Optional folder scope.") },
				["field"],
			),
			readOnly: true,
			execute: async ({ field, folder }) => {
				const base = folder ? sanitizeVaultPath(String(folder), { allowedRoots: roots }) : "";
				const files = (
					folder ? getMarkdownFilesInFolder(app, base) : app.vault.getMarkdownFiles()
				).filter((f) => isWithinAllowedRoots(f.path, roots));
				const values = new Set<string>();
				for (const f of files) {
					const fm = app.metadataCache.getFileCache(f)?.frontmatter;
					const v = fm?.[String(field)];
					if (v == null) continue;
					for (const item of Array.isArray(v) ? v : [v]) {
						if (typeof item !== "object") {
							const s = String(item).trim();
							if (s) values.add(s);
						}
					}
				}
				return { field: String(field), values: [...values].sort().slice(0, 200) };
			},
		}),

		create_note: tool({
			description: "Create a new markdown note. Fails if the path already exists.",
			inputSchema: obj(
				{ path: str("Vault path for the new note."), content: str("Initial markdown content.") },
				["path"],
			),
			needsApproval: true,
			execute: async ({ path, content }) => {
				const norm = sanitizeVaultPath(ensureMarkdownPath(String(path)), { allowedRoots: roots });
				await assertWriteStaysInVault(app, norm);
				await ensureParentFolder(app, norm);
				const file = await app.vault.create(norm, String(content ?? ""));
				return { created: true, path: file.path };
			},
		}),

		append_to_note: tool({
			description: "Append text to an existing note (frontmatter-aware for top inserts).",
			inputSchema: obj(
				{
					path: str("Vault path to the existing note."),
					content: str("Markdown to append."),
					position: enumStr(["top", "bottom"], "Where to add it (default bottom)."),
				},
				["path", "content"],
			),
			needsApproval: true,
			execute: async ({ path, content, position }) => {
				const norm = sanitizeVaultPath(ensureMarkdownPath(String(path)), { allowedRoots: roots });
				const file = requireFile(app, norm);
				await assertWriteStaysInVault(app, norm);
				const body = await app.vault.read(file);
				const text = String(content);
				const next =
					position === "top"
						? insertAtNoteBodyStart(body, text.endsWith("\n") ? text : text + "\n")
						: `${body}${body.endsWith("\n") || body.length === 0 ? "" : "\n"}${text}`;
				await app.vault.modify(file, next);
				return { appended: true, path: norm };
			},
		}),

		insert_under_heading: tool({
			description:
				"Insert markdown under an existing heading (matched exactly). Errors if the heading is not found.",
			inputSchema: obj(
				{
					path: str("Vault path to the existing note."),
					heading: str("Exact heading text (without the # markers)."),
					content: str("Markdown to insert under the heading."),
				},
				["path", "heading", "content"],
			),
			needsApproval: true,
			execute: async ({ path, heading, content }) => {
				const norm = sanitizeVaultPath(ensureMarkdownPath(String(path)), { allowedRoots: roots });
				const file = requireFile(app, norm);
				await assertWriteStaysInVault(app, norm);
				const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
				const target = headings.find((h) => h.heading === String(heading));
				if (!target) throw new Error(`Heading "${heading}" not found in ${norm}`);
				const body = await app.vault.read(file);
				const next = insertUnderHeading(body, target.position.start.line, target.level, String(content), headings);
				await app.vault.modify(file, next);
				return { inserted: true, path: norm, heading: String(heading) };
			},
		}),
	};

	return applyGroupOptions(tools, options);
}

// --- helpers ----------------------------------------------------------------

function tool(def: Omit<QATool, "__qaTool">): QATool {
	return { ...def, __qaTool: true };
}
function obj(properties: Record<string, JSONSchema>, required: string[]): JSONSchema {
	return { type: "object", properties, required };
}
function str(description: string): JSONSchema {
	return { type: "string", description };
}
function int(description: string): JSONSchema {
	return { type: "integer", description };
}
function enumStr(values: string[], description: string): JSONSchema {
	return { type: "string", enum: values, description };
}
function toInt(v: unknown, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? Math.floor(n) : fallback;
}
function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}
// These are NOTE tools: confine them to markdown. A bare name gets `.md`; an
// explicit non-`.md` extension is refused so a model can't create/modify a `.js`
// (which a macro could then run) or any other arbitrary file type via a "note" tool.
function ensureMarkdownPath(path: string): string {
	if (/\.md$/i.test(path)) return path;
	if (/\.[a-z0-9]+$/i.test(path)) {
		throw new Error(
			`This tool only operates on markdown notes (.md); refused path: "${path}".`,
		);
	}
	return `${path}.md`;
}
function requireFile(app: App, normalizedPath: string): TFile {
	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(file instanceof TFile)) {
		throw new Error(`Note not found: ${normalizedPath}`);
	}
	return file;
}
async function ensureParentFolder(app: App, normalizedPath: string): Promise<void> {
	const slash = normalizedPath.lastIndexOf("/");
	if (slash <= 0) return;
	const parent = normalizedPath.slice(0, slash);
	if (app.vault.getAbstractFileByPath(parent)) return;
	try {
		await app.vault.createFolder(parent);
	} catch {
		/* already exists / race — ignore */
	}
}
function snippetAround(text: string, idx: number): string {
	const start = Math.max(0, idx - 40);
	return text.slice(start, idx + 80).replace(/\s+/g, " ").trim();
}
function insertUnderHeading(
	body: string,
	headingLine: number,
	headingLevel: number,
	content: string,
	headings: Array<{ position: { start: { line: number } }; level: number }>,
): string {
	const lines = body.split("\n");
	// Find the next heading at the same or shallower level after this one.
	let endLine = lines.length;
	for (const h of headings) {
		if (h.position.start.line > headingLine && h.level <= headingLevel) {
			endLine = h.position.start.line;
			break;
		}
	}
	const insertText = content.endsWith("\n") ? content : content + "\n";
	const before = lines.slice(0, endLine);
	const after = lines.slice(endLine);
	// Trim a trailing blank line in `before` so we do not pile up blank lines.
	while (before.length > headingLine + 1 && before[before.length - 1].trim() === "") {
		before.pop();
	}
	return [...before, insertText.replace(/\n$/, ""), ...after].join("\n");
}
