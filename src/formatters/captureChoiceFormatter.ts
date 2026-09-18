import getEndOfSection from "./helpers/getEndOfSection";
import { insertOrderedCapture } from "./helpers/orderedCaptureInsertion";
import type { TFile } from "obsidian";
import { getActiveMarkdownEditorView } from "../utils/activeMarkdownEditor";
import { getLinesInString } from "src/utility";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_ORDERED,
	CREATE_IF_NOT_FOUND_TOP,
} from "../constants";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { templaterParseTemplate } from "../utilityObsidian";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { prepareCapture, surroundCapture, placeCapture, type CapturePlacementResult } from "./helpers/capturePlacement";
import { CompleteFormatter } from "./completeFormatter";
import * as positioning from "./helpers/insertionPositioning";
import { insertAtNoteBodyStartWithResult } from "../utils/noteContentInsertion";
import { parentFolderPath } from "../utils/pathUtils";
import {
	buildImageEmbedLink,
	IMAGE_CLIPBOARD_MIME_EXTENSIONS,
	saveClipboardImageToVault,
} from "../utils/clipboardImageAttachments";

/**
	* Only ASCII whitespace counts as "nothing to capture". Unicode spaces such as
	* the non-breaking space (U+00A0) are intentional content and must not be
	* dropped, even though String.prototype.trim() strips them (issue #760).
	*/
const ASCII_WHITESPACE_ONLY_REGEX = /^[ \t\r\n\f\v]*$/;

function isCaptureContentEmpty(content: string): boolean {
	return ASCII_WHITESPACE_ONLY_REGEX.test(content);
}

export class CaptureChoiceFormatter extends CompleteFormatter {
	private choice: ICaptureChoice;
	private file: TFile | null = null;
	private fileContent = "";
	private sourcePath: string | null = null;
	private useSelectionAsCaptureValue = true;
	private clipboardImageFallbackEnabled = false;
	private clipboardAttachmentLink: string | null | undefined;
	private createdClipboardAttachmentPaths: string[] = [];
	/**
		* Tracks whether the current formatter instance has already run Templater on the
		* capture payload.  This prevents the same content from being parsed twice in
		* multi-stage formatting flows (see issue #533 – double execution when using
		* tp.system.prompt).
		*/
	private templaterProcessed = false;
	/** A picked heading is a verbatim file line: skip token and escape expansion when matching it. */
	private insertAfterTargetOverride: string | null = null;
	/** Resolved insert-after heading for the success notice; null until the token-driven block path resolves. */
	private lastResolvedInsertAfterHeading: string | null = null;
	/** Expand format-template escapes once, before substitution, so captured backslashes remain literal. */
	private linebreaksProcessed = false;

	public setDestinationFile(file: TFile): void {
		this.file = file;
		this.sourcePath = file.path;
		this.clipboardAttachmentLink = undefined;
		// {{FOLDER}} in a capture body resolves to the destination file's folder.
		this.setTargetFolderPath(parentFolderPath(file.path));
		// Both destination setters run on EVERY write path (existing file, created
		// file, canvas card) immediately before the content pass, so hooking them
		// is what lets a capture's body prompt name its target note (issue #1546).
		this.setPromptRunContext({
			destination: file.path,
			destinationKind: "file",
		});
	}

	public setDestinationSourcePath(path: string): void {
		this.sourcePath = path;
		this.file = null;
		this.clipboardAttachmentLink = undefined;
		this.setTargetFolderPath(parentFolderPath(path));
		this.setPromptRunContext({ destination: path, destinationKind: "file" });
	}

	public setUseSelectionAsCaptureValue(value: boolean): void {
		this.useSelectionAsCaptureValue = value;
	}

	/**
		* Sets (or clears with `null`) the runtime-resolved insert-after target used by the
		* heading-picker option. The value is a verbatim line from the
		* destination file and is matched literally — see `insertAfterTargetOverride`.
		*/
	public setInsertAfterTargetOverride(target: string | null): void {
		this.insertAfterTargetOverride = target;
	}

	/** Resolved heading for this run, including leading # characters; null when no heading was resolved. */
	public getResolvedInsertAfterHeading(): string | null {
		return this.lastResolvedInsertAfterHeading;
	}

	public consumeCreatedClipboardAttachmentPaths(): string[] {
		const paths = this.createdClipboardAttachmentPaths;
		this.createdClipboardAttachmentPaths = [];
		return paths;
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

	protected async getClipboardContent(): Promise<string> {
		const text = await super.getClipboardContent();
		if (text.length > 0 || !this.clipboardImageFallbackEnabled) {
			return text;
		}

		if (this.clipboardAttachmentLink !== undefined) {
			return this.clipboardAttachmentLink ?? "";
		}

		this.clipboardAttachmentLink = await this.saveClipboardImageAsAttachment();
		return this.clipboardAttachmentLink ?? "";
	}

	private async withClipboardImageFallback<T>(work: () => Promise<T>): Promise<T> {
		const previous = this.clipboardImageFallbackEnabled;
		this.clipboardImageFallbackEnabled = true;
		try {
			return await work();
		} finally {
			this.clipboardImageFallbackEnabled = previous;
		}
	}

	private async saveClipboardImageAsAttachment(): Promise<string | null> {
		const clipboard = navigator.clipboard as Clipboard & {
			read?: () => Promise<ClipboardItem[]>;
		};
		if (typeof clipboard?.read !== "function") return null;

		let item: { clipboardItem: ClipboardItem; mimeType: string } | null;
		let data: ArrayBuffer;
		try {
			item = await this.getFirstClipboardImageItem(clipboard);
			if (!item) return null;

			const blob = await item.clipboardItem.getType(item.mimeType);
			data = await blob.arrayBuffer();
		} catch {
			return null;
		}

		const sourcePath = this.getLinkSourcePath() ?? "";
		const file = await saveClipboardImageToVault(
			this.app,
			data,
			item.mimeType,
			sourcePath,
		);
		// Record BEFORE link generation so a linking failure still leaves the
		// created file visible to the engine's rollback.
		this.createdClipboardAttachmentPaths.push(file.path);

		return buildImageEmbedLink(this.app, file, sourcePath);
	}

	private async getFirstClipboardImageItem(clipboard: {
		read: () => Promise<ClipboardItem[]>;
	}): Promise<{ clipboardItem: ClipboardItem; mimeType: string } | null> {
		const items = await clipboard.read();
		for (const clipboardItem of items) {
			const mimeType = clipboardItem.types.find(
				(type) => IMAGE_CLIPBOARD_MIME_EXTENSIONS[type] !== undefined,
			);
			if (mimeType) return { clipboardItem, mimeType };
		}

		return null;
	}

	protected getCurrentFileLink(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		// Resolve links relative to the capture destination; sourcePath is available before file creation.
		const sourcePath = this.sourcePath ?? this.file?.path ?? "";
		return this.app.fileManager.generateMarkdownLink(currentFile, sourcePath);
	}

	public async formatContentWithFile(
		input: string,
		choice: ICaptureChoice,
		fileContent: string,
		file: TFile,
	): Promise<CapturePlacementResult & { captureContent: string; markerOnly?: boolean }> {
		this.choice = choice;
		this.file = file;
		this.fileContent = fileContent;
		if (!choice || !file || fileContent === null) return { content: input, captureContent: input, cursor: { kind: "none" } };
		// Keep {{FOLDER}} pointed at the definitive destination file's folder.
		this.setTargetFolderPath(parentFolderPath(file.path));

		// Process templater here if we're using insert after or prepend or not capturing to active file
		// This is needed because in these cases, the content won't be processed by templaterParseTemplate in CaptureChoiceEngine
		const shouldRunTemplater =
			choice.insertAfter.enabled ||
			!!choice.insertBefore?.enabled ||
			choice.prepend ||
			!choice.captureToActiveFile ||
			choice.activeFileWritePosition === "top" ||
			choice.activeFileWritePosition === "bottom";
		const formatted = await this.formatCapture(input, shouldRunTemplater);
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
		return (await this.formatCapture(input, runTemplater)).content;
	}

	private async formatCapture(input: string, runTemplater: boolean): Promise<CapturePlacementResult & { captureContent: string; markerOnly?: boolean }> {
		// Declare scope here because formatContentOnly can run before a capture choice is assigned.
		let formatted = await this.withClipboardImageFallback(async () =>
			this.withPromptScope("captureText", input, async () =>
				super.formatFileContent(await this.expandTemplateLinebreaksOnce(input)),
			),
		);

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

		const payload = prepareCapture(formatted);
		const placement = payload.cursor.kind === "none"
			? { content: this.fileContent, cursor: payload.cursor }
			: await this.insertCapture(payload);
		return { ...placement, captureContent: payload.content, markerOnly: payload.cursor.kind === "none" && /{{CURSOR}}/i.test(formatted) };
	}

	private async insertCapture(payload: CapturePlacementResult): Promise<CapturePlacementResult> {
		const formatted = payload.content;
		const shouldAppendToBottom = this.choice.prepend ||
			(this.choice.captureToActiveFile && this.choice.activeFileWritePosition === "bottom");
		if (shouldAppendToBottom) {
			const needsLeadingNewline = this.fileContent.length > 0 &&
				!this.fileContent.endsWith("\n") && !formatted.startsWith("\n");
			const separator = !this.choice.task || needsLeadingNewline ? "\n" : "";
			return surroundCapture(payload, this.fileContent + separator);
		}
		if (this.choice.insertAfter.enabled) return this.insertAfterHandler(payload);
		if (this.choice.insertBefore?.enabled) return this.insertBeforeHandler(payload);
		return this.insertAtNoteBodyStartTracking(payload);
	}

	async formatContentOnly(input: string): Promise<string> {
		// Process the input with templater (if needed) at this stage
		// This is the first pass where we want to run any templater code
		const formatted = await this.withClipboardImageFallback(async () =>
			this.withPromptScope("captureText", input, async () =>
				super.formatFileContent(await this.expandTemplateLinebreaksOnce(input)),
			),
		);

		// The engine or formatContentWithFile owns Templater execution; running it here would execute twice.

		const formattedContentIsEmpty = isCaptureContentEmpty(formatted);
		if (formattedContentIsEmpty) return this.fileContent;

		return formatted;
	}

	private async expandTemplateLinebreaksOnce(template: string): Promise<string> {
		if (this.linebreaksProcessed) return template;
		this.linebreaksProcessed = true;
		return this.expandFormatTemplateEscapes(template);
	}

	/** Expand globals before escapes so snippet escapes behave like format-template escapes. */
	private async expandFormatTemplateEscapes(template: string): Promise<string> {
		const withGlobals = await this.replaceGlobalVarInString(template);
		return this.expandLinebreakEscapesOutsideTokens(withGlobals);
	}

	private async insertAfterHandler(payload: CapturePlacementResult): Promise<CapturePlacementResult> {
		const formatted = payload.content;
		const override = this.insertAfterTargetOverride;

		// Expand escapes before validating inline targets. Picked headings always use the block path.
		if (this.choice.insertAfter?.inline && override === null) {
			const inlineTarget: string = await this.formatLocationString(
				await this.expandFormatTemplateEscapes(this.choice.insertAfter.after),
			);
			return await this.insertAfterInlineHandler(payload, inlineTarget);
		}

		// Picked headings match verbatim; other targets expand once and are reused unchanged when created.
		const targetString: string =
			override ??
			(await this.formatLocationString(
				await this.expandFormatTemplateEscapes(this.choice.insertAfter.after),
			));

		// Record the resolved heading for the success notice (ordered captures show
		// '## 2026-06-16' instead of the raw token). Token-driven path only; the
		// promptHeading override sets its own notice text in the engine.
		if (override === null) {
			const firstLine = targetString.split("\n", 1)[0];
			this.lastResolvedInsertAfterHeading = /^#+\s+\S/.test(firstLine)
				? firstLine.trim()
				: null;
		}

		const targetLines = positioning.toTargetLines(targetString);
		if (positioning.isBlankTarget(targetLines)) {
			throw new ChoiceAbortError(
				"Insert-after target is empty after formatting.",
			);
		}

		const fileContentLines: string[] = getLinesInString(this.fileContent);
		// Ordered searches mask YAML and fenced headings without shifting indices; other searches remain unmasked.
		const searchLines = this.isOrderedCreate()
			? positioning.maskNonBodyHeadingsForSearch(fileContentLines, this.fileContent)
			: fileContentLines;
		const { start, end } = positioning.findInsertAfterRange(searchLines, targetLines);
		const targetNotFound = start === -1;
		if (targetNotFound) {
			if (this.choice.insertAfter?.createIfNotFound) {
				return await this.createInsertAfterIfNotFound(payload, targetString);
			}

			throw new ChoiceAbortError(
				`Insert-after target not found: '${targetString}'.`,
			);
		}

		let targetPosition: number;
		if (this.choice.insertAfter?.insertAtEnd) {
			if (!this.file) throw new Error("Tried to get sections without file.");

			// Anchor section detection on the block's first line (a heading there
			// gets correct section semantics), then clamp to the block's last line
			// so we never insert INSIDE the matched multi-line anchor.
			const endOfSectionIndex = getEndOfSection(
				fileContentLines,
				start,
				this.considerSubsectionsForAnchor(fileContentLines, start),
			);
			const sectionEnd = Math.max(
				endOfSectionIndex ?? fileContentLines.length - 1,
				end,
			);

			targetPosition = positioning.findInsertAfterPositionAtSectionEnd(
				fileContentLines,
				sectionEnd,
				this.fileContent,
				formatted,
			);
		} else {
			const blankLineMode =
				this.choice.insertAfter?.blankLineAfterMatchMode ?? "auto";
			// Insert after the block's last line; blank-line skipping keys off it.
			targetPosition = positioning.findInsertAfterPositionWithBlankLines(
				fileContentLines,
				end,
				this.fileContent,
				blankLineMode,
			);
		}

		return this.insertTextAfterPositionInBody(
			payload,
			this.fileContent,
			targetPosition,
		);
	}

	private async insertBeforeHandler(payload: CapturePlacementResult): Promise<CapturePlacementResult> {
		const insertBefore = this.choice.insertBefore;
		if (!insertBefore) {
			throw new ChoiceAbortError("Insert-before settings are missing.");
		}

		// Expand `\n` escapes before searching (symmetric with the create path)
		// and reuse the resolved string for create so they cannot diverge.
		const targetString: string = await this.formatLocationString(
			await this.expandFormatTemplateEscapes(insertBefore.before),
		);

		const targetLines = positioning.toTargetLines(targetString);
		if (positioning.isBlankTarget(targetLines)) {
			throw new ChoiceAbortError(
				"Insert-before target is empty after formatting.",
			);
		}

		const fileContentLines: string[] = getLinesInString(this.fileContent);
		// Insert-before anchors on the block's FIRST line so the capture lands
		// before the whole multi-line anchor (never inside it — issue #742).
		const { start } = positioning.findInsertAfterRange(fileContentLines, targetLines);
		const targetNotFound = start === -1;
		if (targetNotFound) {
			if (insertBefore.createIfNotFound) {
				return await this.createInsertBeforeIfNotFound(payload, targetString);
			}

			throw new ChoiceAbortError(
				`Insert-before target not found: '${targetString}'.`,
			);
		}

		return this.insertTextBeforePositionInBody(
			payload,
			this.fileContent,
			start,
		);
	}

	private async insertAfterInlineHandler(
		payload: CapturePlacementResult,
		targetString: string,
	): Promise<CapturePlacementResult> {
		if (positioning.hasInlineTargetLinebreak(targetString)) {
			// Inline targets must stay on one line, including after escape expansion.
			throw new ChoiceAbortError(
				"Inline insert-after target must be a single line — remove the line break (\\n) or turn off inline insertion.",
			);
		}

		const matchIndex = this.fileContent.indexOf(targetString);
		if (matchIndex === -1) {
			if (this.choice.insertAfter?.createIfNotFound) {
				return await this.createInlineInsertAfterIfNotFound(
					payload,
					targetString,
				);
			}

			throw new ChoiceAbortError(
				`Inline insert-after target not found: '${targetString}'.`,
			);
		}

		const matchEnd = matchIndex + targetString.length;
		const end = this.choice.insertAfter?.replaceExisting
			? positioning.getInlineEndOfLine(this.fileContent, matchEnd)
			: matchEnd;
		return surroundCapture(payload, this.fileContent.slice(0, matchEnd), this.fileContent.slice(end));
	}
	private async createInsertAfterIfNotFound(formatted: CapturePlacementResult, insertAfterLine: string) {
		const settings = this.choice.insertAfter;
		if (settings?.createIfNotFoundLocation === CREATE_IF_NOT_FOUND_ORDERED) {
			return this.createInsertAfterOrdered(formatted, insertAfterLine);
		}
		const payload = surroundCapture(formatted, `${insertAfterLine}\n`);
		return this.createMissingTarget({
			payload,
			location: settings?.createIfNotFoundLocation,
			rawTarget: settings.after,
			insertAtCursor: (line) => {
				let position = line;
				if (settings?.insertAtEnd) {
					if (!this.file) throw new Error("Tried to get sections without file.");
					const lines = getLinesInString(this.fileContent);
					const end = getEndOfSection(lines, line, this.considerSubsectionsForAnchor(lines, line));
					position = positioning.findInsertAfterPositionAtSectionEnd(
						lines, end ?? lines.length - 1, this.fileContent, payload.content,
					);
				}
				return this.insertTextAfterPositionInBody(payload, this.fileContent, position);
			},
		});
	}

	/** True when this capture uses the ordered create-if-not-found location. */
	private isOrderedCreate(): boolean {
		return (
			!!this.choice.insertAfter?.createIfNotFound &&
			this.choice.insertAfter?.createIfNotFoundLocation ===
				CREATE_IF_NOT_FOUND_ORDERED
		);
	}

	/**
	 * Adapter: binds this run's `considerSubsections` choice flag to the pure
	 * helper. Kept (unlike the single-use file-content passthroughs, which are
	 * inlined at their call site) because it dedupes the flag binding across the
	 * three insert-after positioning call sites.
	 */
	private considerSubsectionsForAnchor(
		lines: string[],
		anchorLine: number,
	): boolean {
		return positioning.anchorAllowsSubsections(
			!!this.choice.insertAfter?.considerSubsections,
			lines,
			anchorLine,
		);
	}
	private createInsertAfterOrdered(payload: CapturePlacementResult, targetString: string): CapturePlacementResult {
		return insertOrderedCapture({
			capture: payload, targetString, fileContent: this.fileContent,
			insertAfter: this.choice.insertAfter, task: !!this.choice.task,
		});
	}
	private async createInsertBeforeIfNotFound(formatted: CapturePlacementResult, insertBeforeLine: string) {
		const settings = this.choice.insertBefore;
		if (!settings) throw new ChoiceAbortError("Insert-before settings are missing.");
		const payload = surroundCapture(formatted, "", `${formatted.content.endsWith("\n") || formatted.content.length === 0 ? "" : "\n"}${insertBeforeLine}`);
		return this.createMissingTarget({
			payload,
			location: settings.createIfNotFoundLocation,
			rawTarget: settings.before,
			insertAtCursor: (line) => this.insertTextBeforePositionInBody(
				payload, this.fileContent, line,
			),
		});
	}
	private async createInlineInsertAfterIfNotFound(formatted: CapturePlacementResult, targetString: string): Promise<CapturePlacementResult> {
		const payload = surroundCapture(formatted, targetString);
		return this.createMissingTarget({
			payload,
			location: this.choice.insertAfter?.createIfNotFoundLocation,
			rawTarget: this.choice.insertAfter.after,
			insertAtCursor: (line) => this.insertTextAfterPositionInBody(payload, this.fileContent, line),
		});
	}

	/** All create modes share placement and errors; each keeps its cursor insertion semantics. */
	private createMissingTarget({ payload, location, rawTarget, insertAtCursor }: {
		payload: CapturePlacementResult;
		location: string | undefined;
		rawTarget: string;
		insertAtCursor: (line: number) => CapturePlacementResult;
	}): CapturePlacementResult {
		switch (location) {
			case CREATE_IF_NOT_FOUND_TOP:
				return this.insertAtNoteBodyStartTracking(payload);
			case CREATE_IF_NOT_FOUND_BOTTOM:
				return surroundCapture(payload, `${this.fileContent}\n`);
			case CREATE_IF_NOT_FOUND_CURSOR: {
				const view = getActiveMarkdownEditorView(this.app);
				if (!view) throw new ChoiceAbortError(
					`Unable to insert line '${rawTarget}' at cursor position: no active markdown editor.`,
				);
				try {
					return insertAtCursor(view.editor.getCursor().line);
				} catch {
					throw new ChoiceAbortError(`Unable to insert line '${rawTarget}' at cursor position.`);
				}
			}
			default:
				throw new ChoiceAbortError(`Unknown createIfNotFoundLocation: ${location}`);
		}
	}

	private insertAtNoteBodyStartTracking(payload: CapturePlacementResult): CapturePlacementResult {
		const result = insertAtNoteBodyStartWithResult(this.fileContent, payload.content);
		return placeCapture(payload, result.content,
			result.insertedStartOffset === null || payload.cursor.kind === "none"
				? null : result.insertedStartOffset + payload.cursor.value);
	}

	private insertTextAfterPositionInBody(payload: CapturePlacementResult, body: string, pos: number): CapturePlacementResult {
		const result = positioning.insertTextAfterPositionInBody(
			payload.content, body, pos, !!this.choice.task,
			payload.cursor.kind === "offset" ? payload.cursor.value : undefined,
		);
		return placeCapture(payload, result.content, result.insertedEndOffset);
	}

	private insertTextBeforePositionInBody(payload: CapturePlacementResult, body: string, pos: number): CapturePlacementResult {
		const result = positioning.insertTextBeforePositionInBody(
			payload.content, body, pos,
			payload.cursor.kind === "offset" ? payload.cursor.value : undefined,
		);
		return placeCapture(payload, result.content, result.insertedEndOffset);
	}
}
