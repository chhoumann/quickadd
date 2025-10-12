import { MarkdownView, type TFile } from "obsidian";
import { getLinesInString } from "src/utility";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_TOP,
} from "../constants";
import { log } from "../logger/logManager";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { templaterParseTemplate } from "../utilityObsidian";
import { reportError } from "../utils/errorUtils";
import { CompleteFormatter } from "./completeFormatter";
import getEndOfSection from "./helpers/getEndOfSection";
import { findYamlFrontMatterRange } from "../utils/yamlContext";

export class CaptureChoiceFormatter extends CompleteFormatter {
	private choice: ICaptureChoice;
	private file: TFile | null = null;
	private fileContent = "";
	/**
	 * Tracks whether the current formatter instance has already run Templater on the
	 * capture payload.  This prevents the same content from being parsed twice in
	 * multi-stage formatting flows (see issue #533 – double execution when using
	 * tp.system.prompt).
	 */
	private templaterProcessed = false;

	protected getCurrentFileLink(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		// Use the capture destination as the source context so relative links work correctly
		// e.g., if active file is Projects/Idea.md and capture target is Journal/Inbox.md,
		// we want [[Projects/Idea]], not [[Idea]]
		const sourcePath = this.file?.path ?? currentFile.path;
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
			!choice.captureToActiveFile;
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
			const shouldInsertLinebreak = !this.choice.task;
			return `${this.fileContent}${shouldInsertLinebreak ? "\n" : ""
				}${formatted}`;
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

			// 2. Check for regex-compatible match (target + only whitespace suffix)
			if (line.startsWith(target)) {
				const suffix = line.slice(target.length);
				// If suffix is only whitespace, this matches old regex behavior exactly
				if (/^\s*$/.test(suffix)) return i;
				
				// Remember first broader prefix match as fallback
				if (partialIndex === -1) {
					partialIndex = i;
				}
			}
		}

		return partialIndex; // -1 if no match at all
	}

	private async insertAfterHandler(formatted: string) {
		// Use centralized location formatting for selector strings
		const targetString: string = await this.formatLocationString(
			this.choice.insertAfter.after,
		);

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

			targetPosition = endOfSectionIndex ?? fileContentLines.length - 1;
		}

		return this.insertTextAfterPositionInBody(
			formatted,
			this.fileContent,
			targetPosition,
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
