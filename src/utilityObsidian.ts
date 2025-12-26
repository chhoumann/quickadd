import type {
	App,
	CachedMetadata,
	TAbstractFile,
	WorkspaceLeaf,
} from "obsidian";
import { FileView, MarkdownView, TFile, TFolder } from "obsidian";
import { log } from "./logger/logManager";
import { NLDParser } from "./parsers/NLDParser";
import type { CaptureChoice } from "./types/choices/CaptureChoice";
import type IChoice from "./types/choices/IChoice";
import type { MacroChoice } from "./types/choices/MacroChoice";
import type { MultiChoice } from "./types/choices/MultiChoice";
import type { TemplateChoice } from "./types/choices/TemplateChoice";
import type {
	OpenLocation as FileOpenLocation,
	OpenFileOptions as FileOpenOptions,
	FileViewMode2 as FileViewModeNew
} from "./types/fileOpening";
import type { AppendLinkOptions, LinkPlacement } from "./types/linkPlacement";
import { placementSupportsEmbed } from "./types/linkPlacement";
import type { IUserScript } from "./types/macros/IUserScript";
import { reportError } from "./utils/errorUtils";
import { deepClone } from "./utils/deepClone";

export type TemplaterPluginLike = {
	settings?: {
		trigger_on_file_creation?: boolean;
		auto_jump_to_cursor?: boolean;
	};
	templater?: {
		overwrite_file_commands?: (f: TFile) => Promise<void>;
		parse_template?: (
			opt: { target_file: TFile; run_mode: number },
			content: string,
		) => Promise<string>;
		files_with_pending_templates?: Set<string>;
		functions_generator?: { teardown?: () => Promise<void> };
	};
	editor_handler?: {
		plugin?: unknown;
		jump_to_next_cursor_location?: (
			file?: TFile | null,
			auto_jump?: boolean,
		) => Promise<void>;
	};
};

/**
 * Wait until the filesystem reports a stable mtime for the file or the timeout elapses.
 * This removes the need for an arbitrary debounce (e.g., 75 ms) and is resilient across
 * local SSDs, network shares, and different OSes.
 */
export async function waitForFileSettle(app: App, file: TFile, timeoutMs = 500) {
	try {
		const adapter = app.vault.adapter;
		if (!("stat" in adapter) || typeof adapter.stat !== "function") return;

		const firstStat = await adapter.stat(file.path);
		if (!firstStat) return; // Unable to get file info – skip waiting.
		let previousMtime = firstStat.mtime;
		const start = Date.now();

		// Poll with exponential backoff until the mtime is stable or we hit the timeout.
		let pollIntervalMs = 30;
		while (Date.now() - start < timeoutMs) {
			await new Promise((r) => setTimeout(r, pollIntervalMs));
			const current = await adapter.stat(file.path);
			if (!current) return; // stat failed; abort waiting.
			if (current.mtime === previousMtime) return;
			previousMtime = current.mtime;
			// Double the interval if mtime keeps changing (exponential backoff)
			pollIntervalMs = Math.min(pollIntervalMs * 2, 200);
		}
	} catch (err) {
		// Non-fatal – we'll fall back to immediate processing.
		log.logWarning(`waitForFileSettle: fallback due to adapter/stat failure – ${(err as Error).message}`);
	}
}

export function getTemplater(app: App) {
	return app.plugins.plugins["templater-obsidian"];
}

export function getTemplaterPlugin(app: App): TemplaterPluginLike | null {
	const plugin = getTemplater(app);
	if (!plugin) return null;
	return plugin as unknown as TemplaterPluginLike;
}

export function isTemplaterTriggerOnCreateEnabled(app: App): boolean {
	return !!getTemplaterPlugin(app)?.settings?.trigger_on_file_creation;
}

export async function waitForTemplaterTriggerOnCreateToComplete(
	app: App,
	file: TFile,
	opts: { timeoutMs?: number; appearTimeoutMs?: number } = {},
): Promise<void> {
	if (file.extension !== "md") return;
	if (!isTemplaterTriggerOnCreateEnabled(app)) return;

	const plugin = getTemplaterPlugin(app);
	const pendingFiles = plugin?.templater?.files_with_pending_templates;
	if (!(pendingFiles instanceof Set)) {
		await waitForFileToStopChanging(app, file, {
			timeoutMs: opts.timeoutMs ?? 5000,
			gracePeriodMs: opts.appearTimeoutMs ?? 2500,
			quietPeriodMs: 200,
		});
		return;
	}

	const { timeoutMs = 5000, appearTimeoutMs = 2500 } = opts;
	const start = Date.now();

	while (Date.now() - start < appearTimeoutMs) {
		if (pendingFiles.has(file.path)) break;
		await new Promise((r) => setTimeout(r, 50));
	}

	while (Date.now() - start < timeoutMs) {
		if (!pendingFiles.has(file.path)) break;
		await new Promise((r) => setTimeout(r, 50));
	}

	await waitForFileSettle(app, file, 800);
}

type TemplaterFileCreationSuppressionState = {
	count: number;
	hadPathInitially: boolean;
};

const templaterFileCreationSuppressions = new Map<
	string,
	TemplaterFileCreationSuppressionState
>();
let activeTemplaterFileCreationSuppressions = 0;
let templaterSuppressionTeardownLock: Promise<void> | null = null;

// Templater waits ~300ms before checking `files_with_pending_templates` in its
// on-create handler. We hold the entry slightly longer to ensure the bypass is
// observed.
// Tested with templater-obsidian v2.x; may need adjustment if Templater internals
// change.
const TEMPLATER_PENDING_CHECK_BUFFER_MS = 350;

async function maybeTeardownTemplaterAfterSuppression(
	app: App,
	plugin: TemplaterPluginLike,
	pendingFiles: Set<string>,
): Promise<void> {
	if (activeTemplaterFileCreationSuppressions > 0) return;
	if (pendingFiles.size !== 0) return;

	if (templaterSuppressionTeardownLock) {
		await templaterSuppressionTeardownLock;
		return;
	}

	templaterSuppressionTeardownLock = (async () => {
		try {
			app.workspace.trigger("templater:all-templates-executed");
			await plugin.templater?.functions_generator?.teardown?.();
		} catch (err) {
			log.logWarning(
				`withTemplaterFileCreationSuppressed: teardown failed – ${(err as Error).message}`,
			);
		}
	})();

	try {
		await templaterSuppressionTeardownLock;
	} finally {
		templaterSuppressionTeardownLock = null;
	}
}

export async function withTemplaterFileCreationSuppressed<T>(
	app: App,
	filePath: string,
	fn: () => Promise<T>,
): Promise<T> {
	const plugin = getTemplaterPlugin(app);
	const pendingFiles = plugin?.templater?.files_with_pending_templates;
	if (
		!plugin ||
		!isTemplaterTriggerOnCreateEnabled(app) ||
		!(pendingFiles instanceof Set)
	) {
		return await fn();
	}

	activeTemplaterFileCreationSuppressions++;

	let state = templaterFileCreationSuppressions.get(filePath);
	if (!state) {
		state = {
			count: 0,
			hadPathInitially: pendingFiles.has(filePath),
		};
		templaterFileCreationSuppressions.set(filePath, state);

		if (!state.hadPathInitially) {
			pendingFiles.add(filePath);
		}
	}

	state.count++;

	let fnSucceeded = false;
	try {
		const result = await fn();
		fnSucceeded = true;
		return result;
	} finally {
		state.count--;
		activeTemplaterFileCreationSuppressions--;

			if (state.count <= 0) {
				templaterFileCreationSuppressions.delete(filePath);

				if (!state.hadPathInitially) {
					if (fnSucceeded) {
						const minHoldMs = TEMPLATER_PENDING_CHECK_BUFFER_MS;
						await new Promise((r) => setTimeout(r, minHoldMs));
					}

					pendingFiles.delete(filePath);

				// By temporarily adding entries to Templater's internal Set, we can
				// prevent its own teardown from firing when other tasks finish.
				// When the Set is empty again (and no suppressions are active),
				// emulate the "all templates executed" teardown to avoid leaving
				// internal state around.
				await maybeTeardownTemplaterAfterSuppression(app, plugin, pendingFiles);
			}
		}
	}
}

export async function waitForFileToStopChanging(
	app: App,
	file: TFile,
	opts: {
		timeoutMs?: number;
		quietPeriodMs?: number;
		gracePeriodMs?: number;
	} = {},
): Promise<void> {
	const {
		timeoutMs = 2000,
		quietPeriodMs = 150,
		gracePeriodMs = 800,
	} = opts;

	try {
		const adapter = app.vault.adapter;
		if (!("stat" in adapter) || typeof adapter.stat !== "function") return;

		const firstStat = await adapter.stat(file.path);
		if (!firstStat) return;

		let lastMtime = firstStat.mtime;
		let lastChangeAt = Date.now();
		let sawExternalChange = false;
		const start = lastChangeAt;

		let pollIntervalMs = 50;
		while (Date.now() - start < timeoutMs) {
			await new Promise((r) => setTimeout(r, pollIntervalMs));
			const current = await adapter.stat(file.path);
			if (!current) return;

			const now = Date.now();
			if (current.mtime !== lastMtime) {
				sawExternalChange = true;
				lastMtime = current.mtime;
				lastChangeAt = now;
				pollIntervalMs = 50;
				continue;
			}

			if (sawExternalChange) {
				if (now - lastChangeAt >= quietPeriodMs) return;
			} else {
				if (now - start >= gracePeriodMs) return;
			}

			pollIntervalMs = Math.min(Math.floor(pollIntervalMs * 1.5), 200);
		}
	} catch (err) {
		log.logWarning(
			`waitForFileToStopChanging: fallback due to adapter/stat failure – ${(err as Error).message}`,
		);
	}
}

const templaterRenderLocks = new Map<string, Promise<void>>();

async function withTemplaterFileLock<T>(
	filePath: string,
	fn: () => Promise<T>,
): Promise<T> {
	const previous = templaterRenderLocks.get(filePath) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = () => resolve();
	});

	const chain = previous
		.catch(() => undefined)
		.then(() => current);

	templaterRenderLocks.set(filePath, chain);

	chain
		.finally(() => {
			if (templaterRenderLocks.get(filePath) === chain) {
				templaterRenderLocks.delete(filePath);
			}
		})
		.catch(() => undefined);

	await previous.catch(() => undefined);
	try {
		return await fn();
	} finally {
		release();
	}
}

export async function overwriteTemplaterOnce(
	app: App,
	file: TFile,
	opts: { skipIfNoTags?: boolean; postWait?: boolean } = {},
): Promise<void> {
	if (file.extension !== "md") return;

	const plugin = getTemplaterPlugin(app);
	const templater = plugin?.templater;
	const overwrite = templater?.overwrite_file_commands;
	if (!plugin || !templater || typeof overwrite !== "function") return;

	const { skipIfNoTags = true, postWait = true } = opts;

	await withTemplaterFileLock(file.path, async () => {
		// Ensure the initial QuickAdd write is flushed & stable on disk.
		await waitForFileSettle(app, file);

		let original: string;
		try {
			original = await app.vault.read(file);
		} catch (err) {
			reportError(
				err as Error,
				`overwriteTemplaterOnce: failed to read ${file.path} before render`,
			);
			return;
		}

		if (skipIfNoTags && !original.includes("<%")) {
			return;
		}

		try {
			// Preserve Templater's internal `this` context.
			await overwrite.call(templater, file);
			if (postWait) {
				await waitForFileSettle(app, file, 800);
			}
		} catch (err) {
			// Roll back to original content to avoid partial renders
			try {
				await app.vault.modify(file, original);
			} catch (rollbackErr) {
				log.logWarning(
					`Failed to rollback ${file.path} after Templater error: ${(rollbackErr as Error).message}`,
				);
			}
			reportError(
				err as Error,
				`Templater failed on ${file.path}. Rolled back to pre-render state.`,
			);
		}
	});
}

export async function templaterParseTemplate(
	app: App,
	templateContent: string,
	targetFile: TFile,
) {
	if (targetFile.extension !== "md") return templateContent;

	const plugin = getTemplaterPlugin(app);
	const templater = plugin?.templater;
	const parseTemplate = templater?.parse_template;
	if (!plugin || !templater || typeof parseTemplate !== "function")
		return templateContent;

	// Preserve Templater's internal `this` context.
	return await parseTemplate.call(
		templater,
		// `run_mode: 4` maps to Templater's internal `RunMode.DynamicProcessor`.
		{ target_file: targetFile, run_mode: 4 },
		templateContent,
	);
}

export async function jumpToNextTemplaterCursorIfPossible(
	app: App,
	file: TFile,
): Promise<void> {
	if (file.extension !== "md") return;
	if (app.workspace.getActiveFile()?.path !== file.path) return;

	const plugin = getTemplaterPlugin(app);
	const autoJumpEnabled = !!plugin?.settings?.auto_jump_to_cursor;
	const editorHandler = plugin?.editor_handler;
	const jump = editorHandler?.jump_to_next_cursor_location;

	if (!autoJumpEnabled) return;

	if (typeof jump === "function") {
		try {
			// Preserve Templater's internal `this` context.
			await jump.call(editorHandler, file, true);
			return;
		} catch (err) {
			log.logWarning(
				`jumpToNextTemplaterCursorIfPossible: API failed – ${(err as Error).message}`,
			);
		}
	}

	try {
		(
			app.commands as unknown as {
				executeCommandById?: (commandId: string) => boolean;
			}
		).executeCommandById?.(
			"templater-obsidian:jump-to-next-cursor-location",
		);
	} catch {
		// no-op
	}
}

export function getNaturalLanguageDates() {
	return NLDParser;
}

export function getDate(input?: { format?: string; offset?: number; }) {
	let duration;

	if (
		input?.offset !== null &&
		input?.offset !== undefined &&
		typeof input.offset === "number"
	) {
		duration = window.moment.duration(input.offset, "days");
	}

	return input?.format
		? window.moment().add(duration).format(input.format)
		: window.moment().add(duration).format("YYYY-MM-DD");
}

export function appendToCurrentLine(toAppend: string, app: App) {
	try {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);

		if (!activeView) {
			log.logError(`unable to append '${toAppend}' to current line.`);
			return;
		}

		activeView.editor.replaceSelection(toAppend);
	} catch {
		log.logError(`unable to append '${toAppend}' to current line.`);
	}
}

export function insertOnNewLine(toInsert: string, direction: "above" | "below", app: App) {
	try {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);

		if (!activeView) {
			log.logError(`unable to insert '${toInsert}' on new line ${direction}.`);
			return;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const lineNumber = cursor.line;

		if (direction === "above") {
			// Insert at the beginning of the current line, add content + newline
			editor.replaceRange(toInsert + "\n", { line: lineNumber, ch: 0 });
			// Move cursor to end of inserted content (before the newline)
			editor.setCursor({ line: lineNumber, ch: toInsert.length });
		} else {
			// Insert at the end of the current line, add newline + content
			const currentLine = editor.getLine(lineNumber);
			editor.replaceRange("\n" + toInsert, { line: lineNumber, ch: currentLine.length });
			// Move cursor to end of inserted content
			editor.setCursor({ line: lineNumber + 1, ch: toInsert.length });
		}
	} catch {
		log.logError(`unable to insert '${toInsert}' on new line ${direction}.`);
	}
}

export function insertOnNewLineAbove(toInsert: string, app: App) {
	insertOnNewLine(toInsert, "above", app);
}

export function insertOnNewLineBelow(toInsert: string, app: App) {
	insertOnNewLine(toInsert, "below", app);
}

/**
 * Core routine that inserts a link (or any text) in the active markdown
 * editor according to the chosen placement mode.
 *
 * – Works with any number of cursors / selections.
 * – Falls back gracefully if no markdown editor is focused.
 * – Keeps the editor's undo history clean by performing a single
 *   CodeMirror transaction.
 */
export function insertLinkWithPlacement(
	app: App,
	text: string,
	mode: LinkPlacement = "replaceSelection",
	options: { requireActiveView?: boolean; } = {},
) {
	const { requireActiveView = true } = options;
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		const message = "Cannot append link because no active Markdown view is available.";
		if (requireActiveView) {
			throw new Error(message);
		}
		log.logMessage(message);
		return;
	}

	const editor = view.editor;

	// Snapshot current selections *before* mutating the document.
	// We copy them because CodeMirror mutates the objects in-place.
	const selections = editor
		.listSelections()
		.map((sel) => ({
			anchor: { ...sel.anchor },
			head: { ...sel.head },
		}));

	//////////////////////////////////////////////////////////////////
	//  REPLACE-SELECTION
	//////////////////////////////////////////////////////////////////
	if (mode === "replaceSelection") {
		editor.replaceSelection(text);
		return;
	}

	//////////////////////////////////////////////////////////////////
	//  ALL OTHER MODES NEED EXPLICIT POSITION CALCULATION
	//////////////////////////////////////////////////////////////////

	/**
		* Helper that converts a {line, ch} position to a monotonically
		* increasing index so we can sort selections bottom-to-top.
		* Sorting bottom-to-top prevents indices from becoming stale while
		* we insert (because later lines are modified first).
		*/
	const asIndex = ({ line, ch }: { line: number; ch: number; }) =>
		editor.posToOffset({ line, ch });

	// Sort selections by document position (descending)
	const ordered = selections.sort(
		(a, b) => asIndex(b.head) - asIndex(a.head),
	);

	// Perform all insertions sequentially for simplicity
	for (const sel of ordered) {
		const head =
			asIndex(sel.anchor) > asIndex(sel.head) ? sel.anchor : sel.head;

		switch (mode) {
			//////////////////////////////////////////////////////////////////
			//  AFTER-SELECTION
			//////////////////////////////////////////////////////////////////
			case "afterSelection": {
				editor.replaceRange(text, head);
				break;
			}

			//////////////////////////////////////////////////////////////////
			//  END-OF-LINE
			//////////////////////////////////////////////////////////////////
			case "endOfLine": {
				const lineStr = editor.getLine(head.line);
				const eolPos = { line: head.line, ch: lineStr.length };
				editor.replaceRange(text, eolPos);
				break;
			}

			//////////////////////////////////////////////////////////////////
			//  NEW-LINE
			//////////////////////////////////////////////////////////////////
			case "newLine": {
				const lineStr = editor.getLine(head.line);
				const eolPos = { line: head.line, ch: lineStr.length };
				// prepend newline only if the current line isn't empty
				const isLineEmpty = lineStr.length === 0;
				const prefix = isLineEmpty ? "" : "\n";
				editor.replaceRange(prefix + text, eolPos);
				break;
			}
		}
	}
}

/**
	* Extracts the target path from a markdown-style link.
	* Works with both wiki-style and markdown-style links.
	*/
function extractMarkdownLinkTarget(link: string): string | null {
	const markdownPattern = /^\s*!?\[[^\]]*\]\((.+)\)\s*$/;
	const match = link.match(markdownPattern);
	if (!match) {
		return null;
	}

	let target = match[1].trim();
	if (!target) {
		return null;
	}

	if (target.startsWith("<") && target.endsWith(">")) {
		target = target.slice(1, -1).trim();
	}

	return target;
}

/**
	* Converts a regular link to an embed by adding the embed prefix (!).
	* Works with both wiki-style and markdown-style links.
	*/
function convertLinkToEmbed(link: string): string {
	// Embeds must leverage wiki-style transclusions (`![[...]]`) because Obsidian interprets markdown image syntax (`![...](...)`) as attachment images, not note embeds.
	const trimmed = link.trim();
	if (trimmed.startsWith("![[") && trimmed.includes("]]")) {
		return link;
	}

	const wikiOpenIndex = link.indexOf("[[");
	const wikiCloseIndex = link.indexOf("]]", wikiOpenIndex + 2);
	if (wikiOpenIndex !== -1 && wikiCloseIndex !== -1) {
		const precedingChar = wikiOpenIndex > 0 ? link.charAt(wikiOpenIndex - 1) : "";
		if (precedingChar === "!") {
			return link;
		}
		return `${link.slice(0, wikiOpenIndex)}!${link.slice(wikiOpenIndex)}`;
	}

	const markdownTarget = extractMarkdownLinkTarget(link);
	if (markdownTarget) {
		return `![[${markdownTarget}]]`;
	}

	return link.startsWith("!") ? link : `!${link}`;
}

/**
 * Inserts a link to the specified file into the active view, respecting 
 * Obsidian's "New link format" setting.
 * 
 * @param app - The Obsidian app instance
 * @param file - The file to link to
 * @param linkOptions - Options controlling link insertion behavior
 * @returns True if the link was inserted, false otherwise
 */
export function insertFileLinkToActiveView(
	app: App,
	file: TFile,
	linkOptions: AppendLinkOptions,
): boolean {
	if (!linkOptions?.enabled) return false;

	const activeFile = app.workspace.getActiveFile();
	if (!activeFile && linkOptions.requireActiveFile) {
		throw new Error("Append link is enabled but there's no active file to insert into.");
	}

	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		if (linkOptions.requireActiveFile) {
			throw new Error("Cannot append link because no active Markdown view is available.");
		}
		return false;
	}

	const sourcePath = activeFile?.path ?? "";
	const baseLink = app.fileManager.generateMarkdownLink(file, sourcePath);
	const shouldEmbed =
		linkOptions.linkType === "embed" &&
		placementSupportsEmbed(linkOptions.placement);
	const linkText = shouldEmbed ? convertLinkToEmbed(baseLink) : baseLink;

	insertLinkWithPlacement(
		app,
		linkText,
		linkOptions.placement,
		{ requireActiveView: false },
	);

	return true;
}

export function findObsidianCommand(app: App, commandId: string) {
	return app.commands.findCommand(commandId);
}

export function deleteObsidianCommand(app: App, commandId: string) {
	if (findObsidianCommand(app, commandId)) {
		delete app.commands.commands[commandId];
		delete app.commands.editorCommands[commandId];
	}
}

export function getAllFolderPathsInVault(app: App): string[] {
	return app.vault
		.getAllLoadedFiles()
		.filter((f) => f instanceof TFolder)
		.map((folder) => folder.path);
}

export function getUserScriptMemberAccess(fullMemberPath: string): {
	basename: string | undefined;
	memberAccess: string[] | undefined;
} {
	// Use "::" exclusively to separate macro/script from member path
	const parts = fullMemberPath
		.split("::")
		.map(p => p.trim())
		.filter(Boolean);

	return {
		basename: parts[0],
		memberAccess: parts.slice(1)
	};
}

// Re-export types for convenience
export type OpenLocation = FileOpenLocation;
export type FileViewMode2 = FileViewModeNew;
export type OpenFileOptions = FileOpenOptions;



/**
 * Open a file (by TFile or vault path) with precise control over location and mode.
 * 
 * @example
 * // Open in a new tab
 * await openFile(app, "daily/2024-01-01.md", { location: "tab" });
 * 
 * @example
 * // Split vertically in source mode
 * await openFile(app, file, { 
 *   location: "split", 
 *   direction: "vertical", 
 *   mode: "source" 
 * });
 * 
 * @example
 * // Open in sidebar without focus
 * await openFile(app, file, { 
 *   location: "right-sidebar", 
 *   focus: false 
 * });
 * 
 * @returns The leaf it opened into.
 */
export async function openFile(
	app: App,
	fileOrPath: TFile | string,
	options: FileOpenOptions = {}
): Promise<WorkspaceLeaf> {
	const {
		location = "tab",
		direction = "vertical",
		mode,
		focus = true,
		eState,
	} = options;

	const file =
		typeof fileOrPath === "string"
			? (app.vault.getAbstractFileByPath(fileOrPath) as TFile | null)
			: fileOrPath;

	if (!file) throw new Error(`File not found: ${String(fileOrPath)}`);

	// Resolve a target leaf for all supported locations
	let leaf: WorkspaceLeaf | null;
	switch (location) {
		case "reuse":
			leaf = app.workspace.getLeaf(false);
			break;
		case "tab":
			leaf = app.workspace.getLeaf("tab");
			break;
		case "split":
			leaf = app.workspace.getLeaf("split", direction);
			break;
		case "window":
			leaf = app.workspace.getLeaf("window");
			break;
		case "left-sidebar":
			leaf = app.workspace.getLeftLeaf(true);
			break;
		case "right-sidebar":
			leaf = app.workspace.getRightLeaf(true);
			break;
		default:
			leaf = app.workspace.getLeaf("tab");
	}
	if (!leaf) throw new Error("Could not obtain a workspace leaf.");

	// Open the file
	await leaf.openFile(file);

	// Optionally adjust view mode (Reading / Live Preview / Source)
	if (mode && mode !== "default" && !(typeof mode === "object" && mode.mode === "default")) {
		const vs = leaf.getViewState();
		const next = { ...(vs.state ?? {}) };

		if (mode === "preview" || (typeof mode === "object" && mode.mode === "preview")) {
			next.mode = "preview";
			delete (next as any).source;
		} else if (mode === "source") {
			next.mode = "source";
			(next as any).source = true;
		} else if (mode === "live" || mode === "live-preview") {
			next.mode = "source";
			(next as any).source = false; // Live Preview = source:false
		} else if (typeof mode === "object" && mode.mode === "source") {
			// advanced override
			next.mode = "source";
			(next as any).source = mode.source;
		}

		// Fix eState usage - merge into state rather than passing as second param
		await leaf.setViewState({ ...vs, state: { ...next, ...eState } });
	}

	if (focus) {
		app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	return leaf;
}

/**
 * Finds an already-open leaf that is displaying `file` and optionally focuses it.
 * Returns the leaf if found, otherwise `null`.
 */
export function openExistingFileTab(
	app: App,
	file: TFile,
	focus = true,
): WorkspaceLeaf | null {
	let leaf: WorkspaceLeaf | undefined = undefined;

	app.workspace.iterateRootLeaves((m_leaf: WorkspaceLeaf) => {
		const view = m_leaf.view;
		if (view instanceof FileView) {
			if (view.file) {
				if (file.path === view.file.path) {
					leaf = m_leaf;
					return;
				}
			}
		}
	});
	if (leaf !== undefined) {
		if (focus) {
			app.workspace.setActiveLeaf(leaf, { focus: true });
		}
		return leaf;
	}
	return null;
}

function extractSingleJavascriptCodeBlock(
	markdown: string,
): { code: string } | null {
	const lines = markdown.split(/\r?\n/);
	const blocks: string[] = [];
	let inFence = false;
	let fenceLength = 0;
	let isJsFence = false;
	let current: string[] = [];

	const isJsLanguage = (language?: string) => {
		const normalized = (language ?? "").toLowerCase();
		return normalized === "js" || normalized === "javascript";
	};

	for (const line of lines) {
		if (!inFence) {
			const match = line.match(/^\s*(`{3,})(.*)$/);
			if (!match) continue;

			const marker = match[1];
			const info = match[2]?.trim() ?? "";
			const language = info.split(/\s+/)[0];

			inFence = true;
			fenceLength = marker.length;
			isJsFence = isJsLanguage(language);
			if (isJsFence) {
				current = [];
			}
			continue;
		}

		const closingMatch = line.match(/^\s*(`{3,})\s*$/);
		if (closingMatch && closingMatch[1].length >= fenceLength) {
			if (isJsFence) {
				blocks.push(current.join("\n"));
			}
			inFence = false;
			fenceLength = 0;
			isJsFence = false;
			continue;
		}

		if (isJsFence) {
			current.push(line);
		}
	}

	if (inFence) return null;
	if (blocks.length !== 1) return null;

	return { code: blocks[0] };
}

// Slightly modified version of Templater's user script import implementation
// Source: https://github.com/SilentVoid13/Templater
export async function getUserScript(command: IUserScript, app: App) {
	// @ts-ignore
	const file: TAbstractFile = app.vault.getAbstractFileByPath(command.path);
	if (!file) {
		log.logError(`failed to load file ${command.path}.`);
		return;
	}

	if (file instanceof TFile) {

		const req = (s: string) => window.require && window.require(s);
		const exp: Record<string, unknown> = {};
		const mod = { exports: exp };

		const fileContent = await app.vault.read(file);
		let scriptSource = fileContent;
		if (file.extension === "md") {
			const extracted = extractSingleJavascriptCodeBlock(fileContent);
			if (!extracted) {
				log.logWarning(
					`User script note '${file.path}' must contain exactly one ` +
						"```js``` or ```javascript``` fenced code block.",
				);
				return;
			}
			scriptSource = extracted.code;
		}

		const fn = window.eval(
			`(function(require, module, exports) { ${scriptSource} \n})`,
		);

		fn(req, mod, exp);

		// @ts-ignore
		const userScript = exp["default"] || mod.exports;
		if (!userScript) return;

		let script = userScript;

		const { memberAccess } = getUserScriptMemberAccess(command.name);
		if (memberAccess && memberAccess.length > 0) {
			let member: string;
			while ((member = memberAccess.shift() as string)) {
				//@ts-ignore

				script = script[member];
			}
		}

		return script;
	}
}

export function excludeKeys<T extends object, K extends keyof T>(
	sourceObj: T,
	except: K[],
): Omit<T, K> {
	const obj = deepClone(sourceObj);

	for (const key of except) {
		delete obj[key];
	}

	return obj;
}

export function getChoiceType<
	T extends TemplateChoice | MultiChoice | CaptureChoice | MacroChoice,
>(choice: IChoice): choice is T {
	const isTemplate = (choice: IChoice): choice is TemplateChoice =>
		choice.type === "Template";
	const isMacro = (choice: IChoice): choice is MacroChoice =>
		choice.type === "Macro";
	const isCapture = (choice: IChoice): choice is CaptureChoice =>
		choice.type === "Capture";
	const isMulti = (choice: IChoice): choice is MultiChoice =>
		choice.type === "Multi";

	return (
		isTemplate(choice) ||
		isMacro(choice) ||
		isCapture(choice) ||
		isMulti(choice)
	);
}

export function isFolder(app: App, path: string): boolean {
	const abstractItem = app.vault.getAbstractFileByPath(path);

	return !!abstractItem && abstractItem instanceof TFolder;
}

export function getMarkdownFilesInFolder(app: App, folderPath: string): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.filter((f) => f.path.startsWith(folderPath));
}

function getFrontmatterTags(fileCache: CachedMetadata): string[] {
	const frontmatter = fileCache.frontmatter;
	if (!frontmatter) return [];

	// You can have both a 'tag' and 'tags' key in frontmatter.
	const frontMatterValues = Object.entries(frontmatter);
	if (!frontMatterValues.length) return [];

	const tagPairs = frontMatterValues.filter(([key, value]) => {
		const lowercaseKey = key.toLowerCase();

		// In Obsidian, these are synonymous.
		return lowercaseKey === "tags" || lowercaseKey === "tag";
	});

	if (!tagPairs) return [];

	const tags = tagPairs
		.flatMap(([key, value]) => {
			if (typeof value === "string") {
				// separator can either be comma or space separated
				return value.split(/,|\s+/).map((v) => v.trim());
			} else if (Array.isArray(value)) {
				return value as string[];
			}
		})
		.filter((v) => !!v) as string[]; // fair to cast after filtering out falsy values

	return tags;
}

function getFileTags(app: App, file: TFile): string[] {
	const fileCache = app.metadataCache.getFileCache(file);
	if (!fileCache) return [];

	const tagsInFile: string[] = [];
	if (fileCache.frontmatter) {
		tagsInFile.push(...getFrontmatterTags(fileCache));
	}

	if (fileCache.tags && Array.isArray(fileCache.tags)) {
		tagsInFile.push(...fileCache.tags.map((v) => v.tag.replace(/^\#/, "")));
	}

	return tagsInFile;
}

export function getMarkdownFilesWithTag(app: App, tag: string): TFile[] {
	const targetTag = tag.replace(/^\#/, "");

	return app.vault.getMarkdownFiles().filter((f: TFile) => {
		const fileTags = getFileTags(app, f);

		return fileTags.includes(targetTag);
	});
}

export const __test = {
	convertLinkToEmbed,
	extractMarkdownLinkTarget,
	extractSingleJavascriptCodeBlock,
} as const;
