import type { App } from "obsidian";
import { TAG_REGEX } from "../../constants";
import { TextInputSuggest } from "./suggest";
import { replaceRange } from "./utils";
import { getQuickAddInstance } from "../../quickAddInstance";
import { TagIndex } from "./TagIndex";

export class TagSuggester extends TextInputSuggest<string> {
	private lastInput = "";
	private lastInputStart = 0;
	private lastInputLength = 0;
	private tagIndex: TagIndex;

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement
	) {
		super(app, inputEl);

		// Read from the shared, vault-wide tag index instead of building a
		// per-instance Fuse index and registering a per-instance, plugin-lifetime
		// metadataCache listener. The latter leaked one TagSuggester per opened
		// prompt and amplified every 'resolved' event into a redundant rebuild.
		this.tagIndex = TagIndex.getInstance(app, getQuickAddInstance());
		// Refresh on open so this prompt sees the current tags even if no
		// 'resolved' event has fired since the vault's tags last changed -
		// preserving the old per-prompt freshness, now with one shared listener.
		this.tagIndex.refresh();
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

		const sortedTags = this.tagIndex.getSortedTags();

		// Prefix matches first. getTags() keys carry a leading '#' but the query
		// (the TAG_REGEX capture) does not, so compare against the tag with its
		// '#' stripped - otherwise the prefix path never matches and the intended
		// prefix-first, shortest-first ordering silently degrades to Fuse's order.
		const tagInputLower = tagInput.toLowerCase();
		const prefixMatches = sortedTags.filter(tag =>
			tag.replace(/^#/, "").toLowerCase().startsWith(tagInputLower)
		).slice(0, 5);

		// Then fuzzy matches
		const fuzzyResults = this.tagIndex.search(tagInput)
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
