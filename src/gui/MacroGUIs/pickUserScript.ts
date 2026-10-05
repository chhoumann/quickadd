import type { App } from "obsidian";
import { Notice } from "obsidian";
import InputSuggester from "../InputSuggester/inputSuggester";
import { renderNotePathSuggestion } from "../InputSuggester/renderNotePathSuggestion";
import { buildFileDisplayInfos } from "../../utils/fileSyntax";
import { UserCancelError } from "../../errors/UserCancelError";
import {
	type ScriptCandidate,
	candidateLabels,
	loadScriptCandidates,
	noteScriptError,
	resolveScriptSelector,
} from "./scriptCandidates";
import { getUserScriptMemberAccess } from "../../utils/userScript";
import { showNoScriptsFoundNotice } from "./noScriptsFoundNotice";

/**
 * Ask the user for a script file: a `.js` file or a note with a ```js block.
 * Resolves to the candidate's label (the name a script step is stored under)
 * and its path, or null when there is nothing to pick, the user dismisses the
 * picker, or the picked note has no runnable block.
 *
 * With `member`, a script can also be typed with the export to run,
 * `my-script::start`, which becomes the step's name.
 */
export async function pickUserScript(
	app: App,
	{ member = false }: { member?: boolean } = {},
): Promise<{ name: string; path: string } | null> {
	// Read on every call, so scripts and notes created since are listed.
	const candidates = loadScriptCandidates(app);
	if (candidates.length === 0) {
		showNoScriptsFoundNotice(app);
		return null;
	}

	// One unified list: .js paths and notes-with-a-code-block, keyed by path.
	// Rows show the name (a note's title or heading) with the full path beneath
	// it, and search matches both, so same-named scripts in different folders
	// can be told apart and a note is found by the name its row shows.
	const paths = candidates.map((c) => c.file.path);
	const labels = candidateLabels(candidates);
	const titles = buildFileDisplayInfos(
		candidates.map((c) => c.file),
		(file) => app.metadataCache.getFileCache(file),
	);
	let selectedPath: string;
	try {
		selectedPath = await InputSuggester.Suggest(app, labels, paths, {
			placeholder: "Select a script (.js file or note with a ```js block)",
			renderItem: (path, el, matches) => {
				const index = paths.indexOf(path);
				// A typed `script::member` is no file of the list.
				if (index === -1) {
					el.setText(path);
					return;
				}
				renderNotePathSuggestion(el, path, app, {
					matches,
					pathOffset: titles[index].primary.length + 1,
				});
			},
			searchItems: paths.map((path, index) => `${titles[index].primary} ${path}`),
			allowCustomValue: member,
			// Offer what is typed only once it names an export.
			valueExists: (value) => !value.includes("::"),
		});
	} catch (error) {
		if (error instanceof UserCancelError) return null;
		throw error;
	}

	const index = paths.indexOf(selectedPath);
	if (index === -1) return member ? resolveTyped(app, candidates, selectedPath) : null;
	const candidate = candidates[index];

	if (candidate.isMarkdown) {
		const reason = await noteScriptError(app, candidate.file);
		if (reason) {
			new Notice(`QuickAdd: "${candidate.file.path}" - ${reason}`);
			return null;
		}
	}

	return { name: labels[index], path: candidate.file.path };
}

/**
 * A script typed by name with the export to run: `my-script::start`. Notes
 * resolve by path (so a bare basename never picks a note over a same-named
 * .js); .js files by basename too. The typed value is the step's name.
 */
async function resolveTyped(
	app: App,
	candidates: ScriptCandidate[],
	value: string,
): Promise<{ name: string; path: string } | null> {
	const name = value.trim();
	const selector = getUserScriptMemberAccess(name).basename ?? name;
	const resolved = resolveScriptSelector(app, candidates, selector);
	if (!resolved) {
		new Notice(`QuickAdd: No script or js-block note named "${name}" found.`);
		return null;
	}
	if (resolved.isMarkdown) {
		const reason = await noteScriptError(app, resolved.file);
		if (reason) {
			new Notice(`QuickAdd: "${resolved.file.path}" - ${reason}`);
			return null;
		}
	}
	return { name, path: resolved.file.path };
}
