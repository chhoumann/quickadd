import Fuse from "fuse.js";
import type { App } from "obsidian";
import { TAG_REGEX } from "../../constants";
import { TextInputSuggest } from "./suggest";
import { replaceRange } from "./utils";

export class SilentTagSuggester extends TextInputSuggest<string> {
	private lastInput = "";
	private lastInputStart = 0;
	private tagSet: Set<string>;
	private sortedTags: string[];
	private fuse: Fuse<string>;

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement
	) {
		super(app, inputEl);

		this.refreshTagIndex();
		
		// Listen to metadata cache changes to refresh tag index
		this.app.metadataCache.on("resolved", this.refreshTagIndex.bind(this));
	}

	private refreshTagIndex(): void {
		// Build and sort the tag list once
		// @ts-expect-error - getTags is available but not in the type definitions
		const tagObj = this.app.metadataCache.getTags();
		const tags = Object.keys(tagObj);
		
		this.tagSet = new Set(tags);
		
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

		const tagInput: string = tagMatch[1];
		this.lastInput = tagInput;
		this.lastInputStart = tagMatch.index! + 1; // +1 to skip the #

		// Prefix matches first
		const prefixMatches = this.sortedTags.filter(tag =>
			tag.toLowerCase().startsWith(tagInput.toLowerCase())
		).slice(0, 5);

		// Then fuzzy matches
		const fuzzyResults = this.fuse.search(tagInput)
			.filter(result => result.score! < 0.8)
			.map(result => result.item)
			.slice(0, 10);

		// Combine and deduplicate, preserving prefix match priority
		const seen = new Set(prefixMatches);
		const combined = [...prefixMatches];
		
		for (const tag of fuzzyResults) {
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
		const replaceStart = this.lastInputStart;
		const replaceEnd = cursorPosition;

		// Replace the partial tag with the complete tag
		replaceRange(this.inputEl, replaceStart, replaceEnd, item);
		this.close();
	}

	destroy(): void {
		super.destroy();
		this.app.metadataCache.off("resolved", this.refreshTagIndex.bind(this));
	}
}


