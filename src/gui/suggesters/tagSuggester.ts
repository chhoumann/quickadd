import Fuse from "fuse.js";
import type { App } from "obsidian";
import { TAG_REGEX } from "../../constants";
import { TextInputSuggest } from "./suggest";
import { replaceRange } from "./utils";
import QuickAdd from "../../main";

export class TagSuggester extends TextInputSuggest<string> {
	private lastInput = "";
	private lastInputStart = 0;
	private lastInputLength = 0;
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
		// Using registerEvent for automatic cleanup when plugin unloads
		QuickAdd.instance.registerEvent(
			this.app.metadataCache.on("resolved", () => this.refreshTagIndex())
		);
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

		// Reject if we are inside a wikilink ([[ … # … ]])
		const lastWiki = inputBeforeCursor.lastIndexOf('[[');
		if (tagMatch.index === undefined) {
			return [];
		}
		if (lastWiki !== -1 && lastWiki < tagMatch.index) {
			return [];
		}

		const tagInput: string = tagMatch[1];
		this.lastInput = tagInput;
		this.lastInputStart = tagMatch.index;
		this.lastInputLength = tagMatch[0].length;

		// Prefix matches first
		const prefixMatches = this.sortedTags.filter(tag =>
			tag.toLowerCase().startsWith(tagInput.toLowerCase())
		).slice(0, 5);

		// Then fuzzy matches
		const fuzzyResults = this.fuse.search(tagInput)
			.filter(result => result.score !== undefined && result.score < 0.8)
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
		this.renderMatch(el, item, this.lastInput);
	}

	selectSuggestion(item: string): void {
		const input = this.inputEl;
		if (input.selectionStart === null) return;

		// Use the stored match position for cursor-position independence
		const tagStart = this.lastInputStart;
		const tagEnd = tagStart + this.lastInputLength;

		// Ensure exactly one '#' in replacement
		const replacement = item.startsWith("#") ? item : `#${item}`;

		replaceRange(input, tagStart, tagEnd, replacement, { fromCompletion: true });
		this.close();
	}
}
