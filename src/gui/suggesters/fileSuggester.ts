/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import { FILE_LINK_REGEX } from "../../constants";
import { FileIndex, type SearchResult, type SearchContext, type IndexedFile } from "./FileIndex";

export class SilentFileSuggester extends TextInputSuggest<SearchResult> {
	private lastInput = "";
	private fileIndex: FileIndex;

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement
	) {
		super(app, inputEl);

		this.fileIndex = FileIndex.getInstance(app);
		
		// Initialize index in background
		this.fileIndex.ensureIndexed();
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

		// Handle embeds/attachments - check if input starts with !
		const isEmbed = inputBeforeCursor.includes('![[');
		if (isEmbed) {
			return this.getAttachmentSuggestions(fileNameInput);
		}

		// Build search context
		const activeFile = this.app.workspace.getActiveFile();
		const context: SearchContext = {
			currentFile: activeFile ?? undefined,
			currentFolder: activeFile?.parent?.path
		};

		return this.fileIndex.search(fileNameInput, context, 50);
	}

	private getHeadingSuggestions(input: string): SearchResult[] {
		const [fileName, headingQuery] = input.split('#');
		const noFileSpecified = fileName.trim() === '';
		
		// Determine candidate files based on whether file part was specified
		let candidateFiles: IndexedFile[] = [];
		
		if (noFileSpecified) {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const indexedFile = this.fileIndex.getFile(activeFile.path);
				if (indexedFile) {
					candidateFiles = [indexedFile];
				}
			}
		} else {
			candidateFiles = this.fileIndex.search(fileName, {}, 1).map(r => r.file);
		}
		
		if (candidateFiles.length === 0) return [];
		
		const results: SearchResult[] = [];
		
		for (const file of candidateFiles) {
			const headings = this.fileIndex.getHeadings(file);
			
			const filteredHeadings = headings
				.filter(h => headingQuery === '' || h.toLowerCase().includes(headingQuery.toLowerCase()))
				.slice(0, 20);
			
			for (const heading of filteredHeadings) {
				results.push({
					file,
					score: 0,
					matchType: 'heading' as const,
					displayText: noFileSpecified ? `#${heading}` : `${file.basename}#${heading}`
				});
			}
		}
		
		return results;
	}



	private getBlockSuggestions(input: string): SearchResult[] {
		const [fileName, blockQuery] = input.split('^');
		const fileResults = this.fileIndex.search(fileName, {}, 1);
		
		if (fileResults.length === 0) return [];
		
		const file = fileResults[0].file;
		const blockIds = this.fileIndex.getBlockIds(file);
		
		return blockIds
			.filter(b => blockQuery === '' || b.toLowerCase().includes(blockQuery.toLowerCase()))
			.slice(0, 20)
			.map(blockId => ({
				file,
				score: 0,
				matchType: 'block' as const,
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
					currentFolder: targetFolder?.path
				}, 20);
			}
		} else if (input.startsWith('./')) {
			const remainingPath = input.substring(2);
			if (remainingPath) {
				return this.fileIndex.search(remainingPath, { 
					currentFolder: targetFolder?.path
				}, 20);
			}
		}

		// Show all files in target folder
		const targetFolderPath = targetFolder?.path ?? "";
		const allResults = this.fileIndex.search('', { 
			currentFolder: targetFolderPath
		}, 50);
		
		// Fix root folder matching - normalize paths for comparison
		return allResults.filter(r => {
			const fileFolder = r.file.folder === "" ? "" : r.file.folder;
			const targetPath = targetFolderPath === "" ? "" : targetFolderPath;
			return fileFolder === targetPath;
		});
	}

	private getAttachmentSuggestions(query: string): SearchResult[] {
		// Get all files, not just markdown
		const allFiles = this.app.vault.getFiles();
		const attachmentExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'mp4', 'webm', 'mov', 'canvas'];
		
		const attachmentFiles = allFiles.filter(file => 
			attachmentExtensions.includes(file.extension.toLowerCase()) &&
			(query === '' || file.basename.toLowerCase().includes(query.toLowerCase()))
		);

		return attachmentFiles
			.slice(0, 20)
			.map(file => ({
				file: {
					path: file.path,
					basename: file.basename,
					aliases: [],
					headings: [],
					blockIds: [],
					tags: [],
					modified: file.stat.mtime,
					folder: file.parent?.path ?? ""
				},
				score: 0,
				matchType: 'exact' as const,
				displayText: file.basename
			}));
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
			case 'heading': {
				const [fileName, heading] = displayText.split('#');
				// Highlight the query in the heading text if possible
				const headingQuery = this.lastInput.includes('#') 
					? this.lastInput.split('#')[1] 
					: '';
				mainText = headingQuery && heading.toLowerCase().includes(headingQuery.toLowerCase())
					? this.renderMatch(heading, headingQuery)
					: heading;
				subText = fileName; // Show source file name
				pill = '<span class="qa-suggestion-pill qa-heading-pill">H</span>';
				break;
			}
			case 'block': {
				const [fileName, blockId] = displayText.split('^');
				mainText = blockId; // Show only the block ID
				subText = fileName; // Show source file name
				pill = '<span class="qa-suggestion-pill qa-block-pill">^</span>';
				break;
			}
			case 'unresolved':
				mainText = displayText;
				subText = "Unresolved link";
				pill = '<span class="qa-suggestion-pill qa-unresolved-pill">unresolved</span>';
				break;
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
		
		const cleanup = () => {
			clearTimeout(tooltipTimeout);
			const existingTooltip = document.querySelector('.qa-file-tooltip');
			existingTooltip?.remove();
		};

		el.addEventListener('mouseenter', () => {
			cleanup(); // Remove any existing tooltips
			tooltipTimeout = setTimeout(async () => {
				const tooltip = this.createTooltip(file);
				if (tooltip) {
					document.body.appendChild(tooltip);
					this.positionTooltip(tooltip, el);
				}
			}, 200);
		});

		// Clean up on multiple events to prevent leaks
		el.addEventListener('mouseleave', cleanup);
		el.addEventListener('blur', cleanup);
		
		// Clean up on scroll to prevent misplaced tooltips
		const cleanupOnScroll = () => cleanup();
		document.addEventListener('scroll', cleanupOnScroll, { passive: true });
		
		// Store cleanup function for later removal
		(el as any)._tooltipCleanup = () => {
			cleanup();
			document.removeEventListener('scroll', cleanupOnScroll);
		};
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

	close(): void {
		// Clean up any tooltip listeners before closing
		const tooltipElements = document.querySelectorAll('.qaFileSuggestionItem');
		tooltipElements.forEach(el => {
			if ((el as any)._tooltipCleanup) {
				(el as any)._tooltipCleanup();
			}
		});
		
		// Remove any existing tooltips
		const existingTooltips = document.querySelectorAll('.qa-file-tooltip');
		existingTooltips.forEach(tooltip => tooltip.remove());
		
		super.close();
	}

	async selectSuggestion(item: SearchResult): Promise<void> {
		if (this.inputEl.selectionStart === null) return;

		const cursorPosition: number = this.inputEl.selectionStart;
		const lastInputLength: number = this.lastInput.length;
		const currentInputValue: string = this.inputEl.value;
		let insertedEndPosition = 0;

		if (item.matchType === 'unresolved') {
			insertedEndPosition = this.makeLinkManually(
				currentInputValue,
				item.displayText.replace(/.md$/, ""),
				cursorPosition,
				lastInputLength
			);
		} else if (item.matchType === 'heading' || item.matchType === 'block') {
			// Heading/block selection - use manual link with full path
			const linkTarget = item.displayText;
			insertedEndPosition = this.makeLinkManually(
				currentInputValue,
				linkTarget,
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
