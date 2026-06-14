import type { App } from "obsidian";
import { TFile } from "obsidian";
import {
	JAVASCRIPT_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../../constants";
import { extractScriptFromMarkdown } from "../../utils/extractScriptFromMarkdown";

/** A file selectable as a user script: a .js file, or a note with a ```js block. */
export interface ScriptCandidate {
	file: TFile;
	isMarkdown: boolean;
}

/**
 * Files a user can pick as a script: every `.js` file, plus notes that have at
 * least one code block. The code-block check is cache-only (cheap, no reads) and
 * can't see the fence language — so a note whose only block is non-JS still shows
 * up; `noteScriptError` is the validate-on-select backstop.
 */
export function loadScriptCandidates(app: App): ScriptCandidate[] {
	const candidates: ScriptCandidate[] = [];
	for (const file of app.vault.getFiles()) {
		if (JAVASCRIPT_FILE_EXTENSION_REGEX.test(file.path)) {
			candidates.push({ file, isMarkdown: false });
		} else if (
			MARKDOWN_FILE_EXTENSION_REGEX.test(file.path) &&
			noteHasCodeBlock(app, file)
		) {
			candidates.push({ file, isMarkdown: true });
		}
	}
	return candidates;
}

function noteHasCodeBlock(app: App, file: TFile): boolean {
	const cache = app.metadataCache.getFileCache(file);
	return cache?.sections?.some((section) => section.type === "code") ?? false;
}

/**
 * Resolve a user-typed selector to a script file.
 *
 * Notes resolve by PATH only, so typing a bare basename never picks a note over a
 * same-named `.js` file — preserving the legacy `.js` typed-add behavior. Falls
 * back to a direct vault lookup so a runnable note (or `.js`) still resolves even
 * when the cache-based candidate pre-filter hasn't indexed it yet (cold cache /
 * freshly created note).
 */
export function resolveScriptSelector(
	app: App,
	candidates: ScriptCandidate[],
	selector: string,
): ScriptCandidate | null {
	const byPath = candidates.find((c) => c.file.path === selector);
	if (byPath) return byPath;

	const byJsBasename = candidates.find(
		(c) => !c.isMarkdown && c.file.basename === selector,
	);
	if (byJsBasename) return byJsBasename;

	const file = app.vault.getAbstractFileByPath(selector);
	if (file instanceof TFile) {
		if (JAVASCRIPT_FILE_EXTENSION_REGEX.test(file.path)) {
			return { file, isMarkdown: false };
		}
		if (MARKDOWN_FILE_EXTENSION_REGEX.test(file.path)) {
			return { file, isMarkdown: true };
		}
	}
	return null;
}

/**
 * Validate a note can be used as a script (validate-on-select). Returns the reason
 * it cannot — the same message the runtime loader surfaces — or `null` when the
 * note has a runnable ```js fence.
 */
export async function noteScriptError(
	app: App,
	file: TFile,
): Promise<string | null> {
	const content = await app.vault.read(file);
	const { code, error } = extractScriptFromMarkdown(content);
	if (code !== null && code.length > 0) return null;
	return error ?? "No ```js code block found in the note.";
}

/** Suggester label: basename for .js (legacy), full path for notes. */
export function candidateLabel(candidate: ScriptCandidate): string {
	return candidate.isMarkdown ? candidate.file.path : candidate.file.basename;
}
