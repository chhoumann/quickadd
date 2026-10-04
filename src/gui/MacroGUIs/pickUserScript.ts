import type { App } from "obsidian";
import { Notice } from "obsidian";
import InputSuggester from "../InputSuggester/inputSuggester";
import { renderNotePathSuggestion } from "../InputSuggester/renderNotePathSuggestion";
import { buildFileDisplayInfos } from "../../utils/fileSyntax";
import { UserCancelError } from "../../errors/UserCancelError";
import {
	candidateLabels,
	loadScriptCandidates,
	noteScriptError,
} from "./scriptCandidates";
import { showNoScriptsFoundNotice } from "./noScriptsFoundNotice";

/**
 * Ask the user for a script file: a `.js` file or a note with a ```js block.
 * Resolves to the candidate's label (the name a script step is stored under)
 * and its path, or null when there is nothing to pick, the user dismisses the
 * picker, or the picked note has no runnable block.
 */
export async function pickUserScript(
	app: App,
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
			renderItem: (path, el, matches) => renderNotePathSuggestion(el, path, app, {
				matches,
				pathOffset: titles[paths.indexOf(path)].primary.length + 1,
			}),
			searchItems: paths.map((path, index) => `${titles[index].primary} ${path}`),
			allowCustomValue: false,
		});
	} catch (error) {
		if (error instanceof UserCancelError) return null;
		throw error;
	}

	const index = paths.indexOf(selectedPath);
	if (index === -1) return null;
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
