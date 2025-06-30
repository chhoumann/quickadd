import Fuse from "fuse.js";
import type { App } from "obsidian";
import { TAG_REGEX } from "../../constants";
import { TextInputSuggest } from "./suggest";
import { replaceRange } from "./utils";
import QuickAdd from "../../main";
import type { FuseResult } from "fuse.js";

export class TagSuggester extends TextInputSuggest<string> {
	private lastInput = "";
	private lastInputStart = 0;
	private sortedTags: string[];
	private fuse: Fuse<string>;

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement
	) {
		super(app, inputEl);

		this.refreshTagIndex();

		// Listen to metadata cache changes to refresh tag index
		// Using registerEvent for automatic cleanup when plugin unloads
		const eventRef = this.app.metadataCache.on("resolved", this.refreshTagIndex.bind(this));
		// Cast is required because the `registerEvent` helper is inherited
		// from Obsidian's `Plugin` → `Component` chain, but the type is not
		// exposed in the default QuickAdd export within this project.
		(QuickAdd.instance as unknown as { registerEvent: (ref: unknown) => void })?.registerEvent(eventRef);
	}

	private refreshTagIndex(): void {
		// Build and sort the tag list once
		// getTags is available on MetadataCache (augmented in `obsidian.d.ts`)
		const tagObj = this.app.metadataCache.getTags();
		const tags = Object.keys(tagObj);

		// Sort tags: prefer shorter tags first, then alphabetically
		this.sortedTags = tags.sort((a, b) => {
			if (a.length !== b.length) {
				return a.length - b.length;
			}
			return a.localeCompare(b);
		});

		// Setup Fuse for fuzzy search
		this.fuse = new Fuse(this.sortedTags, {
			threshold: 0.4,
			includeScore: true,
			keys: [""],
		});
	}

	getSuggestions(inputStr: string): string[] {
		if (this.inputEl.selectionStart === null) {
			return [];
		}

		const cursorPosition: number = this.inputEl.selectionStart;
		const inputBeforeCursor: string = inputStr.slice(0, cursorPosition);
		const tagMatch = TAG_REGEX.exec(inputBeforeCursor);

		if (!tagMatch) {
			return [];
		}

		// Reject if we are inside a wikilink ([[ … # … ]])
		const lastWiki = inputBeforeCursor.lastIndexOf('[[');
		if (lastWiki !== -1 && lastWiki < tagMatch.index!) {
			return [];
		}

		const tagInput: string = tagMatch[1];
		this.lastInput = tagInput;
		this.lastInputStart = tagMatch.index! + 1; // +1 to skip the #

		// Prefix matches first
		const prefixMatches = this.sortedTags
			.filter((tag) => tag.toLowerCase().startsWith(tagInput.toLowerCase()))
			.slice(0, 5);

		// Then fuzzy matches
		const fuzzyResults: FuseResult<string>[] = this.fuse.search(tagInput) as FuseResult<string>[];

		const filteredFuzzy = fuzzyResults
			.filter((result: FuseResult<string>) => result.score !== undefined && result.score < 0.8)
			.map((result: FuseResult<string>) => result.item)
			.slice(0, 10);

		// Combine and deduplicate, preserving prefix match priority
		const seen = new Set(prefixMatches);
		const combined = [...prefixMatches];

		for (const tag of filteredFuzzy) {
			if (!seen.has(tag) && combined.length < 15) {
				combined.push(tag);
				seen.add(tag);
			}
		}

		return combined;
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		// Use highlighting to show why this item matches
		const highlighted = this.renderMatch(item, this.lastInput);
		el.innerHTML = highlighted;
	}

	selectSuggestion(item: string): void {
		if (this.inputEl.selectionStart === null) return;

		const cursorPosition: number = this.inputEl.selectionStart;

		/*
		 * `lastInputStart` is calculated as the index **after** the leading
		 * hash ("#") that the user has already typed. If we start replacing
		 * from that position, the original "#" will remain, resulting in
		 * a duplicate (e.g. "##tag").
		 *
		 * To ensure only a single leading hash, we expand the replacement
		 * range to **include** that character.
		 */
		const replaceStart = Math.max(this.lastInputStart - 1, 0);
		const replaceEnd = cursorPosition;

		// Replace the partial tag (including the leading '#') with the full tag
		replaceRange(this.inputEl, replaceStart, replaceEnd, item);
		this.close();
	}
}


