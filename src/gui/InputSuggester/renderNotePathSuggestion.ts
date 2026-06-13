import { stripMdExtensionForDisplay } from "../suggesters/utils";

/**
 * Renders a vault file path as a Quick-Switcher-style row: the note name on the
 * title line, the parent folder as a muted note line beneath it. Runtime/DOM-only
 * (never invoked in unit tests). Used by the tag-scoped capture picker so it shows
 * note names instead of raw `Some/Deep/Folder/Note.md` paths (issue #745).
 */
export function renderNotePathSuggestion(el: HTMLElement, path: string): void {
	const lastSlash = path.lastIndexOf("/");
	const parent = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
	const basename = stripMdExtensionForDisplay(
		lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
	);

	el.addClass("mod-complex");
	const content = el.createDiv({ cls: "suggestion-content" });
	content.createDiv({ cls: "suggestion-title", text: basename });
	if (parent) {
		content.createDiv({ cls: "suggestion-note", text: parent });
	}
}
