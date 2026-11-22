import { insertOrderedCapture, placeAfterLine, placeAtNoteBodyStart, sectionEndPosition } from "./helpers/orderedCaptureInsertion";
import type { TFile } from "obsidian";
import { getActiveMarkdownEditorView } from "../utils/activeMarkdownEditor";
import { getMarkdownEditorViewForFile } from "../utils/editorInsertion";
import { currentFile } from "../utils/currentFile";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_ORDERED,
	CREATE_IF_NOT_FOUND_TOP,
	NAME_VALUE_REGEX,
} from "../constants";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { getCaptureAction, isEditorAction } from "../engine/captureAction";
import { templaterParseTemplate } from "../utils/templaterIntegration";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { prepareCapture, surroundCapture, placeCapture, type CapturePlacementResult } from "../utils/capturePlacement";
import { CompleteFormatter } from "./completeFormatter";
import { restoreUserText, restoreUserTextInCapture } from "./helpers/userText";
import { hasCursorMarker, isCaptureContentEmpty } from "../utils/capturePlacement";
import * as positioning from "../utils/insertionPositioning";
import { blockquoteSeparator } from "../utils/noteContentInsertion";
import { parentFolderPath } from "../utils/pathUtils";
import {
	buildImageEmbedLink,
	IMAGE_CLIPBOARD_MIME_EXTENSIONS,
	saveClipboardImageToVault,
} from "../utils/clipboardImageAttachments";

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
		const file = currentFile(this.app, this.choiceExecutor);
		if (!file) return null;

		// Resolve links relative to the capture destination; sourcePath is available before file creation.
		const sourcePath = this.sourcePath ?? this.file?.path ?? "";
		return this.app.fileManager.generateMarkdownLink(file, sourcePath);
	}

	public async formatContentWithFile(
		input: string,
		choice: ICaptureChoice,
		fileContent: string,
		file: TFile,
	): Promise<CapturePlacementResult & { captureContent: string; markerOnly?: boolean }> {
		return this.captureIntoFile(input, choice, fileContent, file, true);
	}

	/**
	 * Places text that formatContentOnly already formatted. That text now holds
	 * the selection, clipboard and prompt answers, which are data: formatting it
	 * again would expand tokens and inline scripts written inside them.
	 */
	public async insertFormattedContent(
		formatted: string,
		choice: ICaptureChoice,
		fileContent: string,
		file: TFile,
	): Promise<CapturePlacementResult & { captureContent: string; markerOnly?: boolean }> {
		return this.captureIntoFile(formatted, choice, fileContent, file, false);
	}

	private async captureIntoFile(
		input: string,
		choice: ICaptureChoice,
		fileContent: string,
		file: TFile,
		format: boolean,
	): Promise<CapturePlacementResult & { captureContent: string; markerOnly?: boolean }> {
		this.choice = choice;
		this.file = file;
		this.fileContent = fileContent;
		if (!choice || !file || fileContent === null) {
			const content = restoreUserText(input);
			return { content, captureContent: content, cursor: { kind: "none" } };
		}
		// Keep {{FOLDER}} pointed at the definitive destination file's folder.
		this.setTargetFolderPath(parentFolderPath(file.path));

		// The engine runs Templater itself only for an editor insertion at the cursor.
		const shouldRunTemplater = !isEditorAction(getCaptureAction(choice));
		return await this.formatCapture(input, shouldRunTemplater, format);
	}

	async formatFileContent(input: string, runTemplater = true): Promise<string> {
		return (await this.formatCapture(input, runTemplater)).content;
	}

	private async formatCapture(input: string, runTemplater: boolean, format = true): Promise<CapturePlacementResult & { captureContent: string; markerOnly?: boolean }> {
		// Declare scope here because formatContentOnly can run before a capture choice is assigned.
		let formatted = format ? await this.formatCaptureText(input, !!this.choice?.eachLine) : input;

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

		// User text stays marked until Templater and the {{CURSOR}} search are done.
		const payload = restoreUserTextInCapture(prepareCapture(formatted));
		const placement = payload.cursor.kind === "none"
			? { content: this.fileContent, cursor: payload.cursor }
			: await this.insertCapture(payload);
		return { ...placement, captureContent: payload.content, markerOnly: payload.cursor.kind === "none" && hasCursorMarker(formatted) };
	}

	private async insertCapture(payload: CapturePlacementResult): Promise<CapturePlacementResult> {
		switch (getCaptureAction(this.choice)) {
			case "bottom": return surroundCapture(payload, this.withLastLineEnded());
			case "insertAfter": return this.insertAfterHandler(payload);
			case "insertBefore": return this.insertBeforeHandler(payload);
			default: return placeAtNoteBodyStart(payload, this.fileContent);
		}
	}

	/**
	 * The note, ready for text appended at the bottom. Like the other write
	 * positions, this adds a line break only to end the note's last line. Any
	 * blank line comes from the format.
	 */
	private withLastLineEnded(): string {
		const content = this.fileContent;
		return content.length > 0 && !content.endsWith("\n") ? `${content}\n` : content;
	}

	/**
	 * Formats the capture text. User text in the result stays marked until the
	 * text is placed. `eachLine` writes the format once per line of {{VALUE}}.
	 */
	async formatContentOnly(input: string, options: { eachLine?: boolean } = {}): Promise<string> {
		const formatted = await this.formatCaptureText(input, options.eachLine ?? false);

		// The engine or formatContentWithFile owns Templater execution; running it here would execute twice.

		const formattedContentIsEmpty = isCaptureContentEmpty(formatted);
		if (formattedContentIsEmpty) return this.fileContent;

		return formatted;
	}

	/**
	 * Formats the capture's own text. One entry per line applies to it, a pasted
	 * image becomes an attachment, and user text in the result stays marked.
	 */
	private formatCaptureText(input: string, eachLine: boolean): Promise<string> {
		return this.withValueLines(eachLine, () =>
			this.withClipboardImageFallback(() =>
				this.withPromptScope("captureText", input, () =>
					this.withUserTextProtected(async () =>
						super.formatFileContent(await this.expandTemplateLinebreaksOnce(input))))));
	}

	private splitValueLines = false;

	/** Formats the capture text with One entry per line on or off. */
	private async withValueLines<T>(eachLine: boolean, work: () => Promise<T>): Promise<T> {
		this.splitValueLines = eachLine;
		this.defaultValueInputType = eachLine ? "multiline" : undefined;
		try {
			return await work();
		} finally {
			this.splitValueLines = false;
			this.defaultValueInputType = undefined;
		}
	}

	/**
	 * One entry per line: scripts, macros, and includes run once, then the
	 * format's tokens are filled once per line of the {{VALUE}} answer. Every
	 * other answer is kept by the first line and reused. {{MVALUE}} keeps no
	 * answer, so it is filled once for all lines.
	 */
	protected async format(input: string): Promise<string> {
		if (!this.splitValueLines) return super.format(input);
		// Only the capture format itself; anything it formats later is whole.
		this.splitValueLines = false;

		const expanded = await this.expandCodeAndIncludes(input);
		if (!NAME_VALUE_REGEX.test(expanded)) return this.formatScalarTokens(expanded);
		const answer = await this.resolveValue(expanded);
		const lines = answer.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
		if (lines.length === 0) {
			// An empty answer means the token's default, as it does without this option.
			const context = this.valuePromptContext;
			if (!context?.defaultValue || context.optional) return "";
			lines.push("");
		}

		const shared = await this.replaceMathValueInString(expanded);
		// A value passed in by a script, the URI, the CLI, or the one-page form
		// lives in the variables map, where {{VALUE}} reads it first.
		const seeded = this.hasConcreteVariable("value");
		const seededValue = this.variables.get("value");
		const entries: string[] = [];
		try {
			for (const line of lines) {
				this.value = line;
				if (seeded) this.variables.set("value", line);
				entries.push(await this.formatScalarTokens(shared));
			}
		} finally {
			this.value = answer;
			if (seeded) this.variables.set("value", seededValue);
		}
		return entries
			.map((entry, index) => index < entries.length - 1 && !entry.endsWith("\n") ? `${entry}\n` : entry)
			.join("");
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

		const fileContentLines: string[] = this.fileContent.split("\n");
		// A picked (or typed) heading matches only heading lines, never a
		// same-text line in the frontmatter, a code fence or a paragraph. A typed
		// line that isn't a heading keeps the plain search, so a second run finds
		// the line the first one created. Ordered searches mask YAML and fenced
		// headings; all keep line indices. Other searches are unmasked.
		const searchLines =
			override !== null && positioning.isHeadingLine(override)
				? positioning.onlyHeadingLines(fileContentLines)
				: this.isOrderedCreate()
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
			// gets correct section semantics), and never insert INSIDE the matched
			// multi-line anchor.
			targetPosition = sectionEndPosition({
				lines: fileContentLines, anchorLine: start, lastAnchorLine: end,
				considerSubsections: !!this.choice.insertAfter?.considerSubsections,
				fileContent: this.fileContent, text: formatted,
			});
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

		return placeAfterLine(payload, this.fileContent, targetPosition, !!this.choice.task);
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

		const fileContentLines: string[] = this.fileContent.split("\n");
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
					position = sectionEndPosition({
						lines: this.fileContent.split("\n"), anchorLine: line,
						considerSubsections: !!settings.considerSubsections,
						fileContent: this.fileContent, text: payload.content,
					});
				}
				return placeAfterLine(payload, this.fileContent, position, !!this.choice.task);
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
			insertAtCursor: (line) => placeAfterLine(payload, this.fileContent, line, !!this.choice.task),
		});
	}

	/**
	 * All create modes share placement and errors; each keeps its cursor insertion
	 * semantics. Top and Bottom add a blank line only where the created block and
	 * the note would put two blockquote lines next to each other.
	 */
	private createMissingTarget({ payload, location, rawTarget, insertAtCursor }: {
		payload: CapturePlacementResult;
		location: string | undefined;
		rawTarget: string;
		insertAtCursor: (line: number) => CapturePlacementResult;
	}): CapturePlacementResult {
		switch (location) {
			case CREATE_IF_NOT_FOUND_TOP:
				return placeAtNoteBodyStart(payload, this.fileContent, true);
			case CREATE_IF_NOT_FOUND_BOTTOM: {
				const note = this.withLastLineEnded();
				return surroundCapture(payload, note + blockquoteSeparator(note, payload.content));
			}
			case CREATE_IF_NOT_FOUND_CURSOR: {
				const view = this.file ? getMarkdownEditorViewForFile(this.app, this.file) : getActiveMarkdownEditorView(this.app);
				if (!view) throw new ChoiceAbortError(
					`Unable to insert line '${rawTarget}' at cursor position: ${this.file ? `'${this.file.path}' isn't open in the active editor` : "no active markdown editor"}.`,
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

	private insertTextBeforePositionInBody(payload: CapturePlacementResult, body: string, pos: number): CapturePlacementResult {
		const result = positioning.insertTextBeforePositionInBody(
			payload.content, body, pos,
			payload.cursor.kind === "offset" ? payload.cursor.value : undefined,
		);
		return placeCapture(payload, result.content, result.insertedEndOffset);
	}
}
