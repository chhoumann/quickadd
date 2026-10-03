import { renderMatches, TFile, type App, type SearchMatches } from "obsidian";
import { buildFileDisplayInfos } from "src/utils/fileSyntax";
import { stripMdExtensionForDisplay } from "../suggesters/utils";

/**
 * Renders a vault file path as a Quick-Switcher-style row: the note name on the
 * title line, its location as a muted note line beneath it (the full path when the
 * file is in the vault, else the parent folder). Used by the capture picker so it shows
 * note names instead of raw `Some/Deep/Folder/Note.md` paths (issue #745), and by
 * the macro script picker so same-named scripts can be told apart (issue #942).
 *
 * `highlight` bolds the query's matches, as the quick switcher does. Its
 * `matches` are over a search text that starts with the title and has the
 * path at `pathOffset`.
 */
export function renderNotePathSuggestion(
	el: HTMLElement,
	path: string,
	app?: App,
	highlight?: { matches: SearchMatches; pathOffset: number },
): void {
	const lastSlash = path.lastIndexOf("/");
	const parent = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
	const basename = stripMdExtensionForDisplay(
		lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
	);
	const file = app?.vault.getAbstractFileByPath(path);
	const info = app && file instanceof TFile
		? buildFileDisplayInfos(
				[file],
				(candidate) => app.metadataCache.getFileCache(candidate),
			)[0]
		: null;
	const title = info?.primary ?? basename;
	const note = info?.secondary ?? parent;

	el.addClass("mod-complex");
	const content = el.createDiv({ cls: "suggestion-content" });
	const titleEl = content.createDiv({ cls: "suggestion-title" });
	if (highlight) renderMatches(titleEl, title, highlight.matches);
	else titleEl.setText(title);
	if (!note) return;
	const noteEl = content.createDiv({ cls: "suggestion-note" });
	// Only the full path sits at pathOffset in the search text.
	if (highlight && note === path) {
		renderMatches(noteEl, note, highlight.matches, -highlight.pathOffset);
	} else {
		noteEl.setText(note);
	}
}
