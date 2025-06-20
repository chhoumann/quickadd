/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { FILE_LINK_REGEX } from "../../constants";
import { FileIndex, type SearchResult, type SearchContext } from "./FileIndex";

export class SilentFileSuggester extends TextInputSuggest<SearchResult> {
	private lastInput = "";
	private fileIndex: FileIndex;
	private recentFiles: TFile[] = [];

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement
	) {
		super(app, inputEl);

		this.fileIndex = FileIndex.getInstance(app);
		this.trackRecentFiles();
		this.setupKeyboardShortcuts();
		
		// Initialize index in background
		this.fileIndex.ensureIndexed();
	}

	private trackRecentFiles(): void {
		this.app.workspace.on('file-open', (file) => {
			if (file) {
				// Keep only last 10 recent files
				this.recentFiles = [file, ...this.recentFiles.filter(f => f.path !== file.path)].slice(0, 10);
			}
		});
	}

	private setupKeyboardShortcuts(): void {
		// Enhanced keyboard shortcuts will be handled in the suggest component
		// For now, we'll skip the complex keyboard handling until we can properly
		// access the suggestion state
	}

	private openInNewPane(item: SearchResult): void {
		if (item.matchType === 'unresolved') return;
		
		const file = this.app.vault.getAbstractFileByPath(item.file.path);
		if (file instanceof TFile) {
			this.app.workspace.getLeaf('split').openFile(file);
		}
		this.close();
	}

	private openAndInsertLink(item: SearchResult): void {
		// First insert the link
		this.selectSuggestion(item);
		
		// Then open the file if it exists
		if (item.matchType !== 'unresolved') {
			const file = this.app.vault.getAbstractFileByPath(item.file.path);
			if (file instanceof TFile) {
				this.app.workspace.getLeaf().openFile(file);
			}
		}
	}

	getSuggestions(inputStr: string): SearchResult[] {
		if (this.inputEl.selectionStart === null) return [];

		const cursorPosition: number = this.inputEl.selectionStart;
		const inputBeforeCursor: string = inputStr.substr(0, cursorPosition);
		const fileLinkMatch = FILE_LINK_REGEX.exec(inputBeforeCursor);

		if (!fileLinkMatch) {
			return [];
		}

		const fileNameInput: string = fileLinkMatch[1];
		this.lastInput = fileNameInput;

		// Handle heading/block suggestions
		const hashIndex = fileNameInput.indexOf('#');
		const caretIndex = fileNameInput.indexOf('^');
		
		if (hashIndex > 0) {
			return this.getHeadingSuggestions(fileNameInput);
		}
		
		if (caretIndex > 0) {
			return this.getBlockSuggestions(fileNameInput);
		}

		// Handle relative path shortcuts
		if (fileNameInput.startsWith('./') || fileNameInput.startsWith('../')) {
			return this.getRelativePathSuggestions(fileNameInput);
		}

		// Build search context
		const activeFile = this.app.workspace.getActiveFile();
		const context: SearchContext = {
			currentFile: activeFile ?? undefined,
			currentFolder: activeFile?.parent?.path,
			recentFiles: this.recentFiles
		};

		return this.fileIndex.search(fileNameInput, context, 50);
	}

	private getHeadingSuggestions(input: string): SearchResult[] {
		const [fileName, headingQuery] = input.split('#');
		const fileResults = this.fileIndex.search(fileName, { recentFiles: [] }, 1);
		
		if (fileResults.length === 0) return [];
		
		const file = fileResults[0].file;
		const headings = this.fileIndex.getHeadings(file);
		
		return headings
			.filter(h => headingQuery === '' || h.toLowerCase().includes(headingQuery.toLowerCase()))
			.slice(0, 20)
			.map(heading => ({
				file,
				score: 0,
				matchType: 'exact' as const,
				displayText: `${file.basename}#${heading}`
			}));
	}

	private getBlockSuggestions(input: string): SearchResult[] {
		const [fileName, blockQuery] = input.split('^');
		const fileResults = this.fileIndex.search(fileName, { recentFiles: [] }, 1);
		
		if (fileResults.length === 0) return [];
		
		const file = fileResults[0].file;
		const blockIds = this.fileIndex.getBlockIds(file);
		
		return blockIds
			.filter(b => blockQuery === '' || b.toLowerCase().includes(blockQuery.toLowerCase()))
			.slice(0, 20)
			.map(blockId => ({
				file,
				score: 0,
				matchType: 'exact' as const,
				displayText: `${file.basename}^${blockId}`
			}));
	}

	private getRelativePathSuggestions(input: string): SearchResult[] {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return [];

		let targetFolder = activeFile.parent ?? null;
		
		if (input.startsWith('../')) {
			targetFolder = targetFolder?.parent ?? null;
			const remainingPath = input.substring(3);
			if (remainingPath) {
				return this.fileIndex.search(remainingPath, { 
					currentFolder: targetFolder?.path,
					recentFiles: []
				}, 20);
			}
		} else if (input.startsWith('./')) {
			const remainingPath = input.substring(2);
			if (remainingPath) {
				return this.fileIndex.search(remainingPath, { 
					currentFolder: targetFolder?.path,
					recentFiles: []
				}, 20);
			}
		}

		// Show all files in target folder
		const allResults = this.fileIndex.search('', { 
			currentFolder: targetFolder?.path,
			recentFiles: []
		}, 50);
		
		return allResults.filter(r => r.file.folder === targetFolder?.path);
	}

	renderSuggestion(item: SearchResult, el: HTMLElement): void {
		const { file, matchType, displayText } = item;
		
		// Add CSS classes for theming
		el.classList.add("qaFileSuggestionItem");
		el.classList.add(`qa-suggest-${matchType}`);

		let mainText = displayText;
		let subText = "";
		let pill = "";

		switch (matchType) {
			case 'exact':
				mainText = file.basename;
				subText = file.path;
				break;
			case 'alias':
				mainText = displayText;
				subText = file.path;
				pill = '<span class="qa-suggestion-pill qa-alias-pill">alias</span>';
				break;
			case 'fuzzy':
				mainText = file.basename;
				subText = file.path;
				break;
			case 'unresolved':
				mainText = displayText;
				subText = "Unresolved link";
				pill = '<span class="qa-suggestion-pill qa-unresolved-pill">unresolved</span>';
				break;
		}

		// Show "Create new note" option for unresolved links
		if (matchType === 'unresolved' && !file.path.includes('#') && !file.path.includes('^')) {
			subText = `Create "${displayText}.md"`;
			pill = '<span class="qa-suggestion-pill qa-create-pill">create</span>';
		}

		el.innerHTML = `
			<div class="qa-suggestion-content">
				<span class="suggestion-main-text">${mainText}</span>
				${pill}
			</div>
			<span class="suggestion-sub-text">${subText}</span>
		`;

		// Add hover tooltip for content preview
		this.addHoverTooltip(el, file);
	}

	private addHoverTooltip(el: HTMLElement, file: { path: string }): void {
		let tooltipTimeout: NodeJS.Timeout;
		
		el.addEventListener('mouseenter', () => {
			tooltipTimeout = setTimeout(async () => {
				const tooltip = this.createTooltip(file);
				if (tooltip) {
					document.body.appendChild(tooltip);
					this.positionTooltip(tooltip, el);
				}
			}, 200);
		});

		el.addEventListener('mouseleave', () => {
			clearTimeout(tooltipTimeout);
			const existingTooltip = document.querySelector('.qa-file-tooltip');
			existingTooltip?.remove();
		});
	}

	private createTooltip(file: { path: string }): HTMLElement | null {
		const obsidianFile = this.app.vault.getAbstractFileByPath(file.path);
		if (!obsidianFile || !(obsidianFile instanceof TFile)) return null;

		const tooltip = document.createElement('div');
		tooltip.className = 'qa-file-tooltip';
		
		// For now, just show basic info - content preview can be added later
		tooltip.innerHTML = `
			<div class="qa-tooltip-header">${obsidianFile.basename}</div>
			<div class="qa-tooltip-content">
				<div>Path: ${obsidianFile.path}</div>
				<div>Modified: ${new Date(obsidianFile.stat.mtime).toLocaleDateString()}</div>
			</div>
		`;

		return tooltip;
	}

	private positionTooltip(tooltip: HTMLElement, trigger: HTMLElement): void {
		const rect = trigger.getBoundingClientRect();
		tooltip.style.position = 'fixed';
		tooltip.style.left = `${rect.right + 10}px`;
		tooltip.style.top = `${rect.top}px`;
		tooltip.style.zIndex = '1000';
	}

	async selectSuggestion(item: SearchResult): Promise<void> {
		if (this.inputEl.selectionStart === null) return;

		const cursorPosition: number = this.inputEl.selectionStart;
		const lastInputLength: number = this.lastInput.length;
		const currentInputValue: string = this.inputEl.value;
		let insertedEndPosition = 0;

		// Handle create new note
		if (item.matchType === 'unresolved' && !item.file.path.includes('#') && !item.file.path.includes('^')) {
			insertedEndPosition = await this.createNewNote(item, currentInputValue, cursorPosition, lastInputLength);
		} else if (item.matchType === 'unresolved') {
			// Regular unresolved link
			insertedEndPosition = this.makeLinkManually(
				currentInputValue,
				item.displayText.replace(/.md$/, ""),
				cursorPosition,
				lastInputLength
			);
		} else {
			// Existing file
			const obsidianFile = this.app.vault.getAbstractFileByPath(item.file.path);
			if (obsidianFile instanceof TFile) {
				const alias = item.matchType === 'alias' ? item.displayText : undefined;
				insertedEndPosition = this.makeLinkObsidianMethod(
					obsidianFile,
					currentInputValue,
					cursorPosition,
					lastInputLength,
					alias
				);
			} else {
				insertedEndPosition = this.makeLinkManually(
					currentInputValue,
					item.displayText,
					cursorPosition,
					lastInputLength
				);
			}
		}

		this.inputEl.trigger("input");
		this.close();
		this.inputEl.setSelectionRange(
			insertedEndPosition,
			insertedEndPosition
		);
	}

	private async createNewNote(item: SearchResult, currentInputValue: string, cursorPosition: number, lastInputLength: number): Promise<number> {
		const fileName = item.displayText;
		const activeFile = this.app.workspace.getActiveFile();
		const targetFolder = activeFile?.parent ?? this.app.vault.getRoot();
		
		try {
			const newFile = await this.app.vault.create(
				`${targetFolder.path}/${fileName}.md`,
				""
			);
			
			return this.makeLinkObsidianMethod(
				newFile,
				currentInputValue,
				cursorPosition,
				lastInputLength
			);
		} catch (error) {
			// Fallback to manual link if creation fails
			return this.makeLinkManually(
				currentInputValue,
				fileName,
				cursorPosition,
				lastInputLength
			);
		}
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

}
