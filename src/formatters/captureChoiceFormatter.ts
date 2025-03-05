import { CompleteFormatter } from "./completeFormatter";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { MarkdownView, type TFile } from "obsidian";
import { log } from "../logger/logManager";
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

		// Skip templater processing here since it's already been processed in formatContentOnly
		// Just position the already-formatted content in the file according to settings
		const formatted = await this.formatFileContent(input, false);
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

		// If runTemplater is true and we have a file, run the templater parsing
		// This will only be true during the first formatting stage (formatContentOnly)
		if (runTemplater && this.file) {
			const templaterFormatted = await templaterParseTemplate(
				this.app,
				formatted,
				this.file
			);
			if (templaterFormatted) {
				formatted = templaterFormatted;
			}
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
		
		// If we have a file, run templater parsing once in this first pass
		if (this.file) {
			const templaterFormatted = await templaterParseTemplate(
				this.app,
				formatted,
				this.file
			);
			if (templaterFormatted) {
				formatted = templaterFormatted;
			}
		}

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

			log.logError("unable to find insert after line in file.");
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
			} catch (e) {
				log.logError(
					`unable to insert line '${
						this.choice.insertAfter.after
					}' on your cursor.\n${e as string}`,
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
