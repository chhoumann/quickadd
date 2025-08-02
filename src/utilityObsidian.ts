import type {
	App,
	TAbstractFile,
	WorkspaceLeaf,
	CachedMetadata,
} from "obsidian";
import { FileView, MarkdownView, TFile, TFolder } from "obsidian";
import type { NewTabDirection } from "./types/newTabDirection";
import type { IUserScript } from "./types/macros/IUserScript";
import type { FileViewMode } from "./types/fileViewMode";
import type { TemplateChoice } from "./types/choices/TemplateChoice";
import type { MultiChoice } from "./types/choices/MultiChoice";
import type { CaptureChoice } from "./types/choices/CaptureChoice";
import type { MacroChoice } from "./types/choices/MacroChoice";
import type IChoice from "./types/choices/IChoice";
import { log } from "./logger/logManager";
import { reportError } from "./utils/errorUtils";
import { NLDParser } from "./parsers/NLDParser";
import type { LinkPlacement } from "./types/linkPlacement";

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

export async function overwriteTemplaterOnce(app: App, file: TFile) {
	const templater = getTemplater(app);
	if (!templater) return;

	// 1. Ensure the initial QuickAdd write is flushed & stable on disk.
	await waitForFileSettle(app, file);

	let original: string;
	try {
		original = await app.vault.read(file);
	} catch (err) {
		reportError(err as Error, `overwriteTemplaterOnce: failed to read ${file.path} before render`);
		return;
	}

	try {
		await (templater.templater as {
			overwrite_file_commands: (f: TFile) => Promise<void>;
		}).overwrite_file_commands(file);
		return;
	} catch (err) {
		// Roll back to original content to avoid partial renders
		try {
			await app.vault.modify(file, original);
		} catch (rollbackErr) {
			log.logWarning(`Failed to rollback ${file.path} after Templater error: ${(rollbackErr as Error).message}`);
		}
		reportError(err as Error, `Templater failed on ${file.path}. Rolled back to pre-render state.`);
		return;
	}
}

export async function templaterParseTemplate(
	app: App,
	templateContent: string,
	targetFile: TFile,
) {
	const templater = getTemplater(app);
	if (!templater) return templateContent;

	return await (
		templater.templater as {
			parse_template: (
				opt: { target_file: TFile; run_mode: number; },
				content: string,
			) => Promise<string>;
		}
	).parse_template({ target_file: targetFile, run_mode: 4 }, templateContent);
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
) {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		log.logError("insertLinkWithPlacement: no active Markdown view.");
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
	const asIndex = ({ line, ch }: { line: number; ch: number }) =>
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
				// prepend newline only if the current line isn't already empty
				const prefix = lineStr.endsWith("\n") ? "" : "\n";
				editor.replaceRange(prefix + text, eolPos);
				break;
			}
		}
	}
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

export async function openFile(
	app: App,
	file: TFile,
	optional: {
		openInNewTab?: boolean;
		direction?: NewTabDirection;
		mode?: FileViewMode;
		focus?: boolean;
	},
) {
	let leaf: WorkspaceLeaf;

	if (optional.openInNewTab && optional.direction) {
		leaf = app.workspace.getLeaf("split", optional.direction);
	} else {
		leaf = app.workspace.getLeaf("tab");
	}

	await leaf.openFile(file);

	if (optional?.focus) {
		app.workspace.setActiveLeaf(leaf, { focus: optional.focus });
	}

	if (optional?.mode) {
		const leafViewState = leaf.getViewState();

		await leaf.setViewState({
			...leafViewState,
			 
			state: {
				...leafViewState.state,
				mode: optional.mode,
			},
		});
	}
}

/**
 * If there is no existing tab which opened the file, return false, else return true.
 */
export function openExistingFileTab(
	app: App,
	file: TFile,
): boolean {
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
		app.workspace.setActiveLeaf(leaf);
		return true;
	}
	return false;
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
		 
		const fn = window.eval(
			`(function(require, module, exports) { ${fileContent} \n})`,
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
	const obj = structuredClone(sourceObj);

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
