import { CompleteFormatter } from "./completeFormatter";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { MarkdownView, type TFile } from "obsidian";
import { log } from "../logger/logManager";
import { reportError } from "../utils/errorUtils";
import { templaterParseTemplate } from "../utilityObsidian";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_TOP,
} from "../constants";
import { escapeRegExp, getLinesInString } from "src/utility";
import getEndOfSection from "./helpers/getEndOfSection";

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
		const shouldRunTemplater = choice.insertAfter.enabled || choice.prepend || !choice.captureToActiveFile;
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
			return `${this.fileContent}${
				shouldInsertLinebreak ? "\n" : ""
			}${formatted}`;
		}

		if (this.choice.insertAfter.enabled) {
			return (await this.insertAfterHandler(formatted)) as string;
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const frontmatterEndPosition = this.file
			? this.getFrontmatterEndPosition(this.file)
			: null;
		if (!frontmatterEndPosition) return `${formatted}${this.fileContent}`;

		return this.insertTextAfterPositionInBody(
			formatted,
			this.fileContent,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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

	private async insertAfterHandler(formatted: string) {
		const targetString: string = await this.format(
			this.choice.insertAfter.after,
		);

		const targetRegex = new RegExp(
			`\\s*${escapeRegExp(targetString.replace("\\n", ""))}\\s*`,
		);
		const fileContentLines: string[] = getLinesInString(this.fileContent);

		let targetPosition = fileContentLines.findIndex((line) =>
			targetRegex.test(line),
		);
		const targetNotFound = targetPosition === -1;
		if (targetNotFound) {
			if (this.choice.insertAfter?.createIfNotFound) {
				return await this.createInsertAfterIfNotFound(formatted);
			}

			reportError(new Error("Unable to find insert after line in file"), "Insert After Error");
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
		const insertAfterLine: string = this.replaceLinebreakInString(
			await this.format(this.choice.insertAfter.after),
		);
		const insertAfterLineAndFormatted = `${insertAfterLine}\n${formatted}`;

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_TOP
		) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const frontmatterEndPosition = this.file
				? this.getFrontmatterEndPosition(this.file)
				: -1;
			return this.insertTextAfterPositionInBody(
				insertAfterLineAndFormatted,
				this.fileContent,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
					`Unable to insert line '${this.choice.insertAfter.after}' at cursor position`
				);
			}
		}
	}

	private getFrontmatterEndPosition(file: TFile) {
		const fileCache = this.app.metadataCache.getFileCache(file);

		if (!fileCache || !fileCache.frontmatter) {
			log.logMessage("could not get frontmatter. Maybe there isn't any.");
			return -1;
		}

		if (fileCache.frontmatterPosition) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
			return fileCache.frontmatterPosition.end.line;
		}

		return -1;
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