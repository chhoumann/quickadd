import { TextInputSuggest } from "./suggest";
import type { App, TFile } from "obsidian";
import { FILE_LINK_REGEX } from "../../constants";
import Fuse from "fuse.js";

type AliasArrTFile = TFile & {
	alias: string[];
};

enum FileSuggestionType {
	File,
	Alias,
	Unresolved,
}

type SuggestionMapItem = {
	type: FileSuggestionType;
	file?: TFile;
};

class SuggestionMap extends Map<string, SuggestionMapItem> {}

function buildFileMap(
	files: AliasArrTFile[],
	unresolvedLinkNames: string[]
): SuggestionMap {
	const fileMap = new SuggestionMap();

	for (const file of files) {
		fileMap.set(file.path, {
			file,
			type: FileSuggestionType.File,
		});

		for (const alias of file.alias) {
			fileMap.set(alias, {
				file,
				type: FileSuggestionType.Alias,
			});
		}
	}

	for (const unresolvedLinkName of unresolvedLinkNames) {
		fileMap.set(unresolvedLinkName, {
			type: FileSuggestionType.Unresolved,
		});
	}

	return fileMap;
}

function getAliasesForFile(file: TFile, app: App): AliasArrTFile {
	const fileMetadata = app.metadataCache.getFileCache(file);
	const fileMetaAlias: string | string[] =
		fileMetadata?.frontmatter?.alias ??
		fileMetadata?.frontmatter?.aliases ??
		"";
	const aliases: string[] = [];

	if (typeof fileMetaAlias === "string" && fileMetaAlias) {
		aliases.push(fileMetaAlias);
	} else if (Array.isArray(fileMetaAlias)) {
		const filteredAliases = fileMetaAlias.filter(
			(v) => v && typeof v === "string"
		);

		if (filteredAliases.length) {
			aliases.push(...filteredAliases); // remove null values
		}
	}

	return { ...file, alias: aliases };
}

export class SilentFileSuggester extends TextInputSuggest<string> {
	private lastInput = "";
	private fileNames: string[];
	private fileMap: SuggestionMap;

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement
	) {
		super(app, inputEl);

		const filesAndAliases: AliasArrTFile[] = app.vault
			.getMarkdownFiles()
			.map((file) => getAliasesForFile(file, app));
		const unresolvedLinkNames = this.getUnresolvedLinkNames(app);
		const fileAndAliasMap = buildFileMap(
			filesAndAliases,
			unresolvedLinkNames
		);

		this.fileNames = [...fileAndAliasMap.keys()];
		this.fileMap = fileAndAliasMap;
	}

	getSuggestions(inputStr: string): string[] {
		const cursorPosition: number = this.inputEl.selectionStart!;
		const inputBeforeCursor: string = inputStr.substr(0, cursorPosition);
		const fileLinkMatch = FILE_LINK_REGEX.exec(inputBeforeCursor);

		if (!fileLinkMatch) {
			return [];
		}

		const fileNameInput: string = fileLinkMatch[1];
		this.lastInput = fileNameInput;

		const fuse = new Fuse(this.fileNames, {
			findAllMatches: true,
			shouldSort: true,
			isCaseSensitive: false,
			minMatchCharLength: 1,
			threshold: 0.3,
		});

		const MAX_ITEMS = 50;
		const search = fuse
			.search(this.lastInput)
			.slice(0, MAX_ITEMS)
			.map((value) => value.item);

		return search;
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		const suggestionItem: SuggestionMapItem = this.fileMap.get(item)!;

		switch (suggestionItem.type) {
			case FileSuggestionType.File:
				el.innerHTML = `
                    <span class="suggestion-main-text">${suggestionItem?.file?.basename}</span>
                    <span class="suggestion-sub-text">${suggestionItem?.file?.path}</span>
                `;
				break;
			case FileSuggestionType.Alias:
				el.innerHTML = `
                    <span class="suggestion-main-text">${item}</span>
                    <span class="suggestion-sub-text">${suggestionItem?.file?.path}</span>
                `;
				break;
			case FileSuggestionType.Unresolved:
				el.innerHTML = `
                    <span class="suggestion-main-text">${item}</span>
                    <span class="suggestion-sub-text">Unresolved link</span>
                `;
				break;
			default:
				el.innerHTML = `
                    <span class="suggestion-main-text">${item}</span>
                    <span class="suggestion-sub-text">Unknown</span>
                `;
				break;
		}

		el.classList.add("qaFileSuggestionItem");
	}

	selectSuggestion(item: string): void {
		const cursorPosition: number = this.inputEl.selectionStart!;
		const lastInputLength: number = this.lastInput.length;
		const currentInputValue: string = this.inputEl.value;
		let insertedEndPosition = 0;

		const suggestionItem: SuggestionMapItem = this.fileMap.get(item)!;

		if (suggestionItem.type === FileSuggestionType.File) {
			insertedEndPosition = this.makeLinkObsidianMethod(
				suggestionItem?.file!,
				currentInputValue,
				cursorPosition,
				lastInputLength
			);
		} else if (suggestionItem.type === FileSuggestionType.Alias) {
			insertedEndPosition = this.makeLinkObsidianMethod(
				suggestionItem?.file!,
				currentInputValue,
				cursorPosition,
				lastInputLength,
				item
			);
		} else {
			insertedEndPosition = this.makeLinkManually(
				currentInputValue,
				item.replace(/.md$/, ""),
				cursorPosition,
				lastInputLength
			);
		}

		this.inputEl.trigger("input");
		this.close();
		this.inputEl.setSelectionRange(
			insertedEndPosition,
			insertedEndPosition
		);
	}

	private makeLinkObsidianMethod(
		linkFile: TFile,
		currentInputValue: string,
		cursorPosition: number,
		lastInputLength: number,
		alias?: string
	): number {
		// Need to get file again, otherwise it won't be recognized by the link generator. (hotfix, but not a good solution)
		const file = this.app.vault.getAbstractFileByPath(
			linkFile.path
		) as TFile;
		const link = this.app.fileManager.generateMarkdownLink(
			file,
			"",
			"",
			alias ?? ""
		);
		this.inputEl.value = this.getNewInputValueForFileLink(
			currentInputValue,
			link,
			cursorPosition,
			lastInputLength
		);
		return cursorPosition - lastInputLength + link.length + 2;
	}

	private makeLinkManually(
		currentInputValue: string,
		item: string,
		cursorPosition: number,
		lastInputLength: number
	) {
		this.inputEl.value = this.getNewInputValueForFileName(
			currentInputValue,
			item,
			cursorPosition,
			lastInputLength
		);
		return cursorPosition - lastInputLength + item.length + 2;
	}

	private getNewInputValueForFileLink(
		currentInputElValue: string,
		selectedItem: string,
		cursorPosition: number,
		lastInputLength: number
	): string {
		return `${currentInputElValue.substr(
			0,
			cursorPosition - lastInputLength - 2
		)}${selectedItem}${currentInputElValue.substr(cursorPosition)}`;
	}

	private getNewInputValueForFileName(
		currentInputElValue: string,
		selectedItem: string,
		cursorPosition: number,
		lastInputLength: number
	): string {
		return `${currentInputElValue.substr(
			0,
			cursorPosition - lastInputLength
		)}${selectedItem}]]${currentInputElValue.substr(cursorPosition)}`;
	}

	private getUnresolvedLinkNames(app: App): string[] {
		const unresolvedLinks: Record<string, Record<string, number>> = app
			.metadataCache.unresolvedLinks;
		const unresolvedLinkNames: Set<string> = new Set<string>();

		for (const sourceFileName in unresolvedLinks) {
			for (const unresolvedLink in unresolvedLinks[sourceFileName]) {
				unresolvedLinkNames.add(unresolvedLink);
			}
		}

		return Array.from(unresolvedLinkNames);
	}
}
