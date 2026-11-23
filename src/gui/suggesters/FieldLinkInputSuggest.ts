import { parseFrontMatterAliases, TFile, type App } from "obsidian";
import { FieldSuggestionParser, type FieldFilter } from "src/utils/FieldSuggestionParser";
import { collectFieldValuesWithSource } from "src/utils/FieldValueCollector";
import {
	createFieldLinkOptions,
	ensureLinkValue,
	isAmbiguousBareBasename,
	isLinkValue,
	isRelativeLinkTarget,
	linkTargetOf,
	rankFieldLinkOptions,
	storedFieldLinkTarget,
	type FieldLinkOption,
	type FieldLinkOptions,
	type FieldLinkSuggestion,
} from "src/utils/fieldLinkValues";
import { buildFileDisplayInfos, FILE_PICK_PREFIX, fileLinkNameFromPath } from "src/utils/fileSyntax";
import { renderFieldLinkSuggestion } from "./renderFieldLinkSuggestion";
import { TextInputSuggest } from "./suggest";
import { dispatchCompletion } from "./utils";

const MAX_RESULTS = 200;
const VAULT_ROOT_SOURCE_PATH = "";

/** A note picked in a link field: `@file:<path>` for vault notes or a literal link for unresolved ones. */
export interface FieldLinkPick {
	value: string;
	display: string;
	unresolved: boolean;
	title?: string;
}

function pickFromOption(option: FieldLinkOption): FieldLinkPick {
	if (option.kind === "file") {
		return {
			value: storedFieldLinkTarget(option),
			display: option.display,
			unresolved: false,
			title: option.subpath ? `${option.path}${option.subpath}` : option.path,
		};
	}
	return {
		value: option.link,
		display: option.display,
		unresolved: true,
		title: option.link,
	};
}

/**
 * The one-page form's picker for `{{FIELD:<name>|link}}`: the property's
 * values, other notes once you type, and `Link to [[...]]`.
 */
export class FieldLinkInputSuggest extends TextInputSuggest<FieldLinkSuggestion> {
	private readonly fieldName: string;
	private readonly filters: FieldFilter;
	private lookupSequence = 0;
	private visitLoad: Promise<FieldLinkOptions> | undefined;
	private lastLoadedLinks: FieldLinkOptions | undefined;
	private readonly clearVisitLoad = () => {
		this.visitLoad = undefined;
	};

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		fieldSpecifier: string,
		private readonly pickedValues: () => readonly string[],
		private readonly onSelect: (pick: FieldLinkPick) => void,
		private readonly multiSelect: boolean,
	) {
		super(app, inputEl);
		const parsed = FieldSuggestionParser.parse(fieldSpecifier);
		this.fieldName = parsed.fieldName;
		this.filters = parsed.filters;
		if (multiSelect) inputEl.setAttribute("aria-multiselectable", "true");
		inputEl.addEventListener("blur", this.clearVisitLoad);
	}

	destroy(): void {
		this.inputEl.removeEventListener("blur", this.clearVisitLoad);
		super.destroy();
	}

	private load(): Promise<FieldLinkOptions> {
		this.visitLoad ??= collectFieldValuesWithSource(this.app, this.fieldName, this.filters).then(
			({ values, hasDefaultValue }) => {
				this.lastLoadedLinks = createFieldLinkOptions(this.app, values, null, { pinnedFirst: hasDefaultValue });
				return this.lastLoadedLinks;
			},
		);
		return this.visitLoad;
	}

	async getSuggestions(query: string): Promise<FieldLinkSuggestion[]> {
		const lookup = ++this.lookupSequence;
		const links = await this.load();
		if (lookup !== this.lookupSequence) return [];
		const picked = this.pickedValues();
		const excludeIds = new Set<string>();
		for (const value of picked) {
			const resolution = links.resolveTyped(value);
			if (resolution.kind === "option") excludeIds.add(resolution.option.id);
		}
		return rankFieldLinkOptions(links, query, {
			limit: MAX_RESULTS,
			scope: "all",
			excludeIds,
			includeNewRow: true,
		}).filter((suggestion) => suggestion.kind !== "new" || !picked.includes(suggestion.link));
	}

	renderSuggestion(suggestion: FieldLinkSuggestion, el: HTMLElement): void {
		renderFieldLinkSuggestion(suggestion, el);
	}

	selectSuggestion(suggestion: FieldLinkSuggestion): void {
		this.onSelect(
			suggestion.kind === "new"
				? { value: suggestion.link, display: suggestion.display, unresolved: true, title: suggestion.link }
				: pickFromOption(suggestion.option),
		);
		this.inputEl.value = "";

		if (!this.multiSelect) {
			this.close();
			return;
		}
		dispatchCompletion(this.inputEl, true);
		this.inputEl.focus();
	}

	/**
	 * What typed or prefilled text links to, without waiting for the vault
	 * read: from the last options read when there are any, else from the vault.
	 */
	resolveTypedSync(text: string): FieldLinkPick | null {
		const trimmed = text.trim();
		if (!trimmed) return null;
		if (this.lastLoadedLinks) {
			const resolution = this.lastLoadedLinks.resolveTyped(trimmed);
			if (resolution.kind === "option") return pickFromOption(resolution.option);
			if (resolution.kind === "new") {
				return { value: resolution.link, display: resolution.display, unresolved: true, title: resolution.link };
			}
		}
		if (trimmed.startsWith(FILE_PICK_PREFIX)) {
			const encoded = trimmed.slice(FILE_PICK_PREFIX.length);
			const hash = encoded.indexOf("#");
			const path = hash === -1 ? encoded : encoded.slice(0, hash);
			const subpath = hash === -1 ? undefined : encoded.slice(hash);
			const abstract = this.app.vault.getAbstractFileByPath?.(path);
			const file =
				abstract instanceof TFile
					? abstract
					: this.app.vault.getMarkdownFiles().find((candidate) => candidate.path === path) ?? null;
			if (file) {
				const [info] = buildFileDisplayInfos([file], (note) => this.app.metadataCache.getFileCache(note));
				const display = subpath ? `${info.label}${subpath}` : info.label;
				return { value: trimmed, display, unresolved: false, title: subpath ? `${file.path}${subpath}` : file.path };
			}
			const name = fileLinkNameFromPath(path);
			if (!name) return null;
			const fallback = `[[${name}${subpath ?? ""}]]`;
			return { value: fallback, display: `${name}${subpath ?? ""}`, unresolved: true, title: fallback };
		}
		const target = linkTargetOf(trimmed);
		if (!target) {
			return isLinkValue(trimmed)
				? { value: trimmed, display: trimmed, unresolved: true, title: trimmed }
				: null;
		}
		const files = this.app.vault.getMarkdownFiles();
		let file =
			isRelativeLinkTarget(target) || isAmbiguousBareBasename(files, target)
				? null
				: this.app.metadataCache.getFirstLinkpathDest(target, VAULT_ROOT_SOURCE_PATH);
		if (!file && !isLinkValue(trimmed)) {
			const lower = trimmed.toLowerCase();
			file =
				files.find((candidate) => {
					const aliases = parseFrontMatterAliases(
						this.app.metadataCache.getFileCache(candidate)?.frontmatter,
					);
					return aliases?.some((alias) => alias.toLowerCase() === lower) ?? false;
				}) ?? null;
		}
		if (!file) {
			const link = ensureLinkValue(trimmed);
			return { value: link, display: target, unresolved: true, title: link };
		}
		const [info] = buildFileDisplayInfos([file], (note) => this.app.metadataCache.getFileCache(note));
		return { value: `${FILE_PICK_PREFIX}${file.path}`, display: info.label, unresolved: false, title: file.path };
	}
}
