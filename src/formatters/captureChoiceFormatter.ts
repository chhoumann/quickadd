import { MarkdownView, type TFile } from "obsidian";
import { getLinesInString } from "src/utility";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_TOP,
} from "../constants";
import { log } from "../logger/logManager";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { BlankLineAfterMatchMode } from "../types/choices/ICaptureChoice";
import { templaterParseTemplate } from "../utilityObsidian";
import { reportError } from "../utils/errorUtils";
import { CompleteFormatter } from "./completeFormatter";
import getEndOfSection from "./helpers/getEndOfSection";
import { findYamlFrontMatterRange } from "../utils/yamlContext";

export class CaptureChoiceFormatter extends CompleteFormatter {
	private choice: ICaptureChoice;
	private file: TFile | null = null;
	private fileContent = "";
	private sourcePath: string | null = null;
	private useSelectionAsCaptureValue = true;
	/**
		* Tracks whether the current formatter instance has already run Templater on the
		* capture payload.  This prevents the same content from being parsed twice in
		* multi-stage formatting flows (see issue #533 – double execution when using
		* tp.system.prompt).
		*/
	private templaterProcessed = false;

	public setDestinationFile(file: TFile): void {
		this.file = file;
		this.sourcePath = file.path;
	}

	public setDestinationSourcePath(path: string): void {
		this.sourcePath = path;
		this.file = null;
	}

	public setUseSelectionAsCaptureValue(value: boolean): void {
		this.useSelectionAsCaptureValue = value;
	}

	protected shouldUseSelectionForValue(): boolean {
		return this.useSelectionAsCaptureValue;
	}

	protected async getSelectedTextForValue(): Promise<string> {
		const selectedText = await this.getSelectedText();
		return selectedText.trim().length > 0 ? selectedText : "";
	}

	protected getLinkSourcePath(): string | null {
		return this.sourcePath ?? this.file?.path ?? null;
	}

	protected getCurrentFileLink(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		// Use the capture destination as the source context so relative links work correctly
		// e.g., if active file is Projects/Idea.md and capture target is Journal/Inbox.md,
		// we want [[Projects/Idea]], not [[Idea]]
		// Prefer sourcePath (set before file creation) over file.path, fallback to empty string
		const sourcePath = this.sourcePath ?? this.file?.path ?? "";
		return this.app.fileManager.generateMarkdownLink(currentFile, sourcePath);
	}

	public async formatContentWithFile(
		input: string,
		choice: ICaptureChoice,
		fileContent: string,
		file: TFile,
	): Promise<string> {
		this.choice = choice;
		this.file = file;
		this.fileContent = fileContent;
		if (!choice || !file || fileContent === null) return input;

		// Process templater here if we're using insert after or prepend or not capturing to active file
		// This is needed because in these cases, the content won't be processed by templaterParseTemplate in CaptureChoiceEngine
		const shouldRunTemplater =
			choice.insertAfter.enabled ||
			choice.prepend ||
			!choice.captureToActiveFile ||
			choice.activeFileWritePosition === "top";
		const formatted = await this.formatFileContent(input, shouldRunTemplater);
		return formatted;
	}

	public async formatContent(
		input: string,
		choice: ICaptureChoice,
	): Promise<string> {
		this.choice = choice;
		if (!choice) return input;

		return await this.formatFileContent(input);
	}

	async formatFileContent(input: string, runTemplater = true): Promise<string> {
		let formatted = await super.formatFileContent(input);
		formatted = this.replaceLinebreakInString(formatted);

		// Run templater only once per capture payload to prevent #533 double execution
		if (runTemplater && this.file && !this.templaterProcessed) {
			const templaterFormatted = await templaterParseTemplate(
				this.app,
				formatted,
				this.file,
			);
			if (templaterFormatted) {
				formatted = templaterFormatted;
			}
			this.templaterProcessed = true;
		}

		const formattedContentIsEmpty = formatted.trim() === "";
		if (formattedContentIsEmpty) return this.fileContent;

		if (this.choice.prepend) {
			// When appending to the end of a file, ensure the capture starts on a new line.
			// Notes are not guaranteed to end with a trailing newline (see issue #124).
			const shouldInsertLinebreak = !this.choice.task;
			const needsLeadingNewline =
				this.fileContent.length > 0 &&
				!this.fileContent.endsWith("\n") &&
				!formatted.startsWith("\n");
			const separator = shouldInsertLinebreak || needsLeadingNewline ? "\n" : "";

			return `${this.fileContent}${separator}${formatted}`;
		}

		if (this.choice.insertAfter.enabled) {
			return (await this.insertAfterHandler(formatted)) as string;
		}

		const frontmatterEndPosition = this.file
			? this.getFrontmatterEndPosition(this.file, this.fileContent)
			: null;
		if (
			frontmatterEndPosition === null ||
			frontmatterEndPosition === undefined ||
			frontmatterEndPosition < 0
		)
			return `${formatted}${this.fileContent}`;

		return this.insertTextAfterPositionInBody(
			formatted,
			this.fileContent,

			frontmatterEndPosition,
		);
	}

	async formatContentOnly(input: string): Promise<string> {
		// Process the input with templater (if needed) at this stage
		// This is the first pass where we want to run any templater code
		let formatted = await super.formatFileContent(input);
		formatted = this.replaceLinebreakInString(formatted);

		// DON'T run templater parsing here - it will be handled either by:
		// 1. CaptureChoiceEngine.run() for the active file + no insert after + no prepend case
		// 2. formatContentWithFile() for all other cases
		// This avoids double processing of templater commands

		const formattedContentIsEmpty = formatted.trim() === "";
		if (formattedContentIsEmpty) return this.fileContent;

		return formatted;
	}

	private normalizeTarget(target: string): string {
		return target.replace("\\n", "").trimEnd();
	}

	private findInsertAfterIndex(lines: string[], rawTarget: string): number {
		const target = this.normalizeTarget(rawTarget);
		let partialIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			// Trim only left whitespace to preserve indentation alignment
			const line = lines[i].trimStart();

			// 1. Exact match wins immediately
			if (line === target) return i;

			// 2. Check for prefix match (target + only whitespace suffix)
			// This matches old regex behavior for lines starting with the target
			if (line.startsWith(target)) {
				const suffix = line.slice(target.length);
				// If suffix is only whitespace, this matches old regex behavior exactly
				if (/^\s*$/.test(suffix)) return i;

				// Remember first broader prefix match as fallback
				if (partialIndex === -1) {
					partialIndex = i;
				}

				continue;
			}

			// 3. Check for substring match (target appears anywhere in line with only whitespace after)
			// This restores legacy behavior where selectors like "| ----- |" can match
			// table separator rows where the target appears at the end
			const targetIndex = line.indexOf(target);
			if (targetIndex !== -1) {
				const suffix = line.slice(targetIndex + target.length);
				// If suffix is only whitespace, match this line
				if (/^\s*$/.test(suffix)) return i;

				// Remember first broader substring match as fallback
				if (partialIndex === -1) {
					partialIndex = i;
				}
			}
		}

		return partialIndex; // -1 if no match at all
	}

	private shouldSkipBlankLinesAfterMatch(
		mode: BlankLineAfterMatchMode,
		line: string,
	): boolean {
		if (mode === "skip") return true;
		if (mode === "none") return false;
		return this.isAtxHeading(line);
	}

	private isAtxHeading(line: string): boolean {
		return /^\s{0,3}#{1,6}\s+\S/.test(line);
	}

	private findInsertAfterPositionWithBlankLines(
		lines: string[],
		matchIndex: number,
		body: string,
		mode: BlankLineAfterMatchMode,
	): number {
		if (matchIndex < 0) return matchIndex;

		const matchLine = lines[matchIndex] ?? "";
		const shouldSkip = this.shouldSkipBlankLinesAfterMatch(mode, matchLine);
		if (!shouldSkip) return matchIndex;

		// Ignore the trailing empty line that results from split("\n") when the
		// file ends with a newline. This preserves existing EOF behavior.
		const scanLimit = body.endsWith("\n")
			? Math.max(lines.length - 1, 0)
			: lines.length;
		let position = matchIndex;

		for (let i = matchIndex + 1; i < scanLimit; i++) {
			if (lines[i].trim().length === 0) {
				position = i;
				continue;
			}
			break;
		}

		return position;
	}

	private findInsertAfterPositionAtSectionEnd(
		lines: string[],
		sectionEndIndex: number,
		body: string,
	): number {
		if (sectionEndIndex < 0) return sectionEndIndex;

		let position = sectionEndIndex;
		let i = sectionEndIndex + 1;

		while (i < lines.length && lines[i].trim().length === 0) {
			position = i;
			i++;
		}

		// Preserve current behavior when there are no trailing blank lines or when
		// blanks are followed by content (e.g. before a new heading).
		if (position === sectionEndIndex || i !== lines.length) {
			return sectionEndIndex;
		}

		// split("\n") keeps a trailing empty string when content ends in "\n".
		// We keep one trailing slot so the next insertion preserves capture spacing
		// without introducing an extra blank line before the inserted text.
		if (body.endsWith("\n")) {
			return Math.max(sectionEndIndex, position - 1);
		}

		return position;
	}

	private async insertAfterHandler(formatted: string) {
		// Use centralized location formatting for selector strings
		const targetString: string = await this.formatLocationString(
			this.choice.insertAfter.after,
		);

		if (this.choice.insertAfter?.inline) {
			return await this.insertAfterInlineHandler(formatted, targetString);
		}

		const fileContentLines: string[] = getLinesInString(this.fileContent);
		let targetPosition = this.findInsertAfterIndex(
			fileContentLines,
			targetString,
		);
		const targetNotFound = targetPosition === -1;
		if (targetNotFound) {
			if (this.choice.insertAfter?.createIfNotFound) {
				return await this.createInsertAfterIfNotFound(formatted);
			}

			reportError(
				new Error("Unable to find insert after line in file"),
				"Insert After Error",
			);
		}

		if (this.choice.insertAfter?.insertAtEnd) {
			if (!this.file) throw new Error("Tried to get sections without file.");

			const endOfSectionIndex = getEndOfSection(
				fileContentLines,
				targetPosition,
				!!this.choice.insertAfter.considerSubsections,
			);

			targetPosition = this.findInsertAfterPositionAtSectionEnd(
				fileContentLines,
				endOfSectionIndex ?? fileContentLines.length - 1,
				this.fileContent,
			);
		} else {
			const blankLineMode =
				this.choice.insertAfter?.blankLineAfterMatchMode ?? "auto";
			targetPosition = this.findInsertAfterPositionWithBlankLines(
				fileContentLines,
				targetPosition,
				this.fileContent,
				blankLineMode,
			);
		}

		return this.insertTextAfterPositionInBody(
			formatted,
			this.fileContent,
			targetPosition,
		);
	}

	private hasInlineTargetLinebreak(target: string): boolean {
		return target.includes("\n") || target.includes("\r");
	}

	private getInlineEndOfLine(startIndex: number): number {
		const newlineIndex = this.fileContent.indexOf("\n", startIndex);
		if (newlineIndex === -1) return this.fileContent.length;
		if (newlineIndex > 0 && this.fileContent[newlineIndex - 1] === "\r") {
			return newlineIndex - 1;
		}
		return newlineIndex;
	}

	private async insertAfterInlineHandler(
		formatted: string,
		targetString: string,
	): Promise<string> {
		if (this.hasInlineTargetLinebreak(targetString)) {
			reportError(
				new Error("Inline insert after target must be a single line."),
				"Insert After Inline Error",
			);
			return this.fileContent;
		}

		const matchIndex = this.fileContent.indexOf(targetString);
		if (matchIndex === -1) {
			if (this.choice.insertAfter?.createIfNotFound) {
				return await this.createInlineInsertAfterIfNotFound(
					formatted,
					targetString,
				);
			}

			reportError(
				new Error("Unable to find insert after text in file."),
				"Insert After Inline Error",
			);
			return this.fileContent;
		}

		const matchEnd = matchIndex + targetString.length;
		if (this.choice.insertAfter?.replaceExisting) {
			const endOfLine = this.getInlineEndOfLine(matchEnd);
			return (
				this.fileContent.slice(0, matchEnd) +
				formatted +
				this.fileContent.slice(endOfLine)
			);
		}

		return (
			this.fileContent.slice(0, matchEnd) +
			formatted +
			this.fileContent.slice(matchEnd)
		);
	}

	private async createInsertAfterIfNotFound(formatted: string) {
		// Build the line to insert using centralized location formatting
		const insertAfterLine: string = this.replaceLinebreakInString(
			await this.formatLocationString(this.choice.insertAfter.after),
		);
		const insertAfterLineAndFormatted = `${insertAfterLine}\n${formatted}`;

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_TOP
		) {
			const frontmatterEndPosition = this.file
				? this.getFrontmatterEndPosition(this.file, this.fileContent)
				: -1;
			return this.insertTextAfterPositionInBody(
				insertAfterLineAndFormatted,
				this.fileContent,

				frontmatterEndPosition,
			);
		}

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_BOTTOM
		) {
			return `${this.fileContent}\n${insertAfterLineAndFormatted}`;
		}

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_CURSOR
		) {
			try {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

				if (!activeView) {
					throw new Error("No active view.");
				}

				const cursor = activeView.editor.getCursor();
				let targetPosition = cursor.line;

				if (this.choice.insertAfter?.insertAtEnd) {
					if (!this.file)
						throw new Error("Tried to get sections without file.");

					const fileContentLines: string[] = getLinesInString(this.fileContent);

					const endOfSectionIndex = getEndOfSection(
						fileContentLines,
						targetPosition,
						!!this.choice.insertAfter.considerSubsections,
					);

					targetPosition = endOfSectionIndex ?? fileContentLines.length - 1;
				}

				const newFileContent = this.insertTextAfterPositionInBody(
					insertAfterLineAndFormatted,
					this.fileContent,
					targetPosition,
				);

				return newFileContent;
			} catch (err) {
				reportError(
					err,
					`Unable to insert line '${this.choice.insertAfter.after}' at cursor position`,
				);
			}
		}
	}

	private async createInlineInsertAfterIfNotFound(
		formatted: string,
		targetString: string,
	): Promise<string> {
		const insertAfterLineAndFormatted = `${targetString}${formatted}`;

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_TOP
		) {
			const frontmatterEndPosition = this.file
				? this.getFrontmatterEndPosition(this.file, this.fileContent)
				: -1;
			return this.insertTextAfterPositionInBody(
				insertAfterLineAndFormatted,
				this.fileContent,
				frontmatterEndPosition,
			);
		}

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_BOTTOM
		) {
			return `${this.fileContent}\n${insertAfterLineAndFormatted}`;
		}

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_CURSOR
		) {
			try {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

				if (!activeView) {
					throw new Error("No active view.");
				}

				const cursor = activeView.editor.getCursor();
				const targetPosition = cursor.line;

				return this.insertTextAfterPositionInBody(
					insertAfterLineAndFormatted,
					this.fileContent,
					targetPosition,
				);
			} catch (err) {
				reportError(
					err,
					`Unable to insert line '${this.choice.insertAfter.after}' at cursor position`,
				);
			}
		}

		log.logWarning(
			`Unknown createIfNotFoundLocation: ${this.choice.insertAfter?.createIfNotFoundLocation}`,
		);
		return this.fileContent;
	}

	private getFrontmatterEndPosition(file: TFile, fallbackContent?: string) {
		const fileCache = this.app.metadataCache.getFileCache(file);

		if (fileCache?.frontmatterPosition) {
			return fileCache.frontmatterPosition.end.line;
		}

		if (fallbackContent) {
			const inferred = this.inferFrontmatterEndLineFromContent(fallbackContent);
			if (inferred !== null) {
				return inferred;
			}
		}

		log.logMessage("could not get frontmatter. Maybe there isn't any.");
		return -1;
	}

	private inferFrontmatterEndLineFromContent(content: string): number | null {
		const yamlRange = findYamlFrontMatterRange(content);
		if (!yamlRange) return null;

		const prefix = content.slice(0, yamlRange[1]);
		const lines = prefix.split(/\r?\n/);
		if (lines.length === 0) return null;

		if (prefix.endsWith("\n")) {
			return lines.length - 2;
		}

		return lines.length - 1;
	}

	private insertTextAfterPositionInBody(
		text: string,
		body: string,
		pos: number,
	): string {
		if (pos === -1) {
			// For the case that there is no frontmatter and we're adding to the top of the file.
			// We already add a linebreak for the task in CaptureChoiceEngine.tsx in getCapturedContent.
			const shouldAddLinebreak = !this.choice.task;
			return `${text}${shouldAddLinebreak ? "\n" : ""}${body}`;
		}

		const splitContent = body.split("\n");
		const pre = splitContent.slice(0, pos + 1).join("\n");
		const post = splitContent.slice(pos + 1).join("\n");

		return `${pre}\n${text}${post}`;
	}
}
