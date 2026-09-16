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
import { CompleteFormatter } from "./completeFormatter";
import getEndOfSection, { getMarkdownHeadings } from "./helpers/getEndOfSection";
import {
	computeOrderedSectionInsertIndex,
	maskFencedHeadings,
	type MomentLike,
	type OrderedSlot,
} from "./helpers/orderedSectionPlacement";
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
	private captureInsertionEndOffset: number | null = null;

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

	public getCaptureInsertionEndOffset(): number | null {
		return this.captureInsertionEndOffset;
	}

	private setCaptureInsertionEndOffset(offset: number | null): void {
		this.captureInsertionEndOffset =
			typeof offset === "number" && Number.isFinite(offset) && offset >= 0
				? offset
				: null;
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
		this.setCaptureInsertionEndOffset(null);
		this.choice = choice;
		this.file = file;
		this.fileContent = fileContent;
		if (!choice || !file || fileContent === null) return input;
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
		// Declared here rather than read from `this.choice`, which is still
		// undefined on the formatContentOnly path (assigned only by
		// formatContentWithFile/formatContent) - the very pass that opens the
		// capture's body {{VALUE}} prompt (issue #1546).
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

		const formattedContentIsEmpty = isCaptureContentEmpty(formatted);
		if (formattedContentIsEmpty) return this.fileContent;

		// Historical note: `prepend` is a legacy flag name that means
		// append-to-bottom behavior.
		const shouldAppendToBottom =
			this.choice.prepend ||
			(this.choice.captureToActiveFile &&
				this.choice.activeFileWritePosition === "bottom");

		if (shouldAppendToBottom) {
			// When appending to the end of a file, ensure the capture starts on a new line.
			// Notes are not guaranteed to end with a trailing newline (see issue #124).
			const shouldInsertLinebreak = !this.choice.task;
			const needsLeadingNewline =
				this.fileContent.length > 0 &&
				!this.fileContent.endsWith("\n") &&
				!formatted.startsWith("\n");
			const separator = shouldInsertLinebreak || needsLeadingNewline ? "\n" : "";

			this.setCaptureInsertionEndOffset(
				this.fileContent.length + separator.length + formatted.length,
			);
			return `${this.fileContent}${separator}${formatted}`;
		}

		if (this.choice.insertAfter.enabled) {
			return await this.insertAfterHandler(formatted);
		}

		if (this.choice.insertBefore?.enabled) {
			return await this.insertBeforeHandler(formatted);
		}

		// Default "write to top" path: insert after any frontmatter so the YAML block
		// is never broken, and never glue the capture onto the first body line (#647).
		return this.insertAtNoteBodyStartTracking(formatted);
	}

	async formatContentOnly(input: string): Promise<string> {
		// Process the input with templater (if needed) at this stage
		// This is the first pass where we want to run any templater code
		const formatted = await this.withClipboardImageFallback(async () =>
			this.withPromptScope("captureText", input, async () =>
				super.formatFileContent(await this.expandTemplateLinebreaksOnce(input)),
			),
		);

		// DON'T run templater parsing here - it will be handled either by:
		// 1. CaptureChoiceEngine.run() for the active file + no insert after + no prepend case
		// 2. formatContentWithFile() for all other cases
		// This avoids double processing of templater commands

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

	private async insertAfterHandler(formatted: string) {
		const override = this.insertAfterTargetOverride;

		// Inline targets are single-line by definition and use a separate
		// indexOf-based path. Expand `\n` escapes here (like the block path below)
		// so a multi-line target trips the single-line guard in
		// insertAfterInlineHandler with a clear error — instead of silently
		// searching for a literal backslash-n that never exists, or writing it
		// verbatim into the note on create-if-not-found (issue #468).
		// The heading-picker override always wants the block (section) path, never
		// the same-line inline path, so the override short-circuits inline here too.
		if (this.choice.insertAfter?.inline && override === null) {
			const inlineTarget: string = await this.formatLocationString(
				await this.expandFormatTemplateEscapes(this.choice.insertAfter.after),
			);
			return await this.insertAfterInlineHandler(formatted, inlineTarget);
		}

		// Override (runtime-picked heading) is a verbatim file line: match it literally,
		// skipping formatLocationString/escape-expansion (see insertAfterTargetOverride).
		// Otherwise expand `\n` escapes BEFORE searching so the search target is identical
		// to what createInsertAfterIfNotFound writes to disk. Computed once and reused for
		// the create path so the two can never diverge (issue #742).
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
		// For ordered placement, the target search must ignore headings inside YAML
		// frontmatter or fenced code blocks. Otherwise a sample/comment heading that
		// happens to match (e.g. a `## 2026-06-16` in a ```markdown example) would be
		// treated as "found" and the capture inserted there, bypassing the
		// fence/frontmatter-aware ordered create path. Masking preserves line indices,
		// so the found-path position math below stays valid. Non-ordered captures keep
		// their existing (unmasked) search behaviour.
		const searchLines = this.isOrderedCreate()
			? positioning.maskNonBodyHeadingsForSearch(fileContentLines, this.fileContent)
			: fileContentLines;
		const { start, end } = positioning.findInsertAfterRange(searchLines, targetLines);
		const targetNotFound = start === -1;
		if (targetNotFound) {
			if (this.choice.insertAfter?.createIfNotFound) {
				return await this.createInsertAfterIfNotFound(formatted, targetString);
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
			formatted,
			this.fileContent,
			targetPosition,
		);
	}

	private async insertBeforeHandler(formatted: string) {
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
				return await this.createInsertBeforeIfNotFound(formatted, targetString);
			}

			throw new ChoiceAbortError(
				`Insert-before target not found: '${targetString}'.`,
			);
		}

		return this.insertTextBeforePositionInBody(
			formatted,
			this.fileContent,
			start,
		);
	}

	private async insertAfterInlineHandler(
		formatted: string,
		targetString: string,
	): Promise<string> {
		if (positioning.hasInlineTargetLinebreak(targetString)) {
			// Inline insertion lands mid-line after a matched substring, so a
			// multi-line target can never match. Abort cleanly with a clear message
			// (parity with the block path's not-found abort) instead of searching for
			// a literal `\n` or writing it verbatim on create-if-not-found (issue #468).
			throw new ChoiceAbortError(
				"Inline insert-after target must be a single line — remove the line break (\\n) or turn off inline insertion.",
			);
		}

		const matchIndex = this.fileContent.indexOf(targetString);
		if (matchIndex === -1) {
			if (this.choice.insertAfter?.createIfNotFound) {
				return await this.createInlineInsertAfterIfNotFound(
					formatted,
					targetString,
				);
			}

			throw new ChoiceAbortError(
				`Inline insert-after target not found: '${targetString}'.`,
			);
		}

		const matchEnd = matchIndex + targetString.length;
		this.setCaptureInsertionEndOffset(matchEnd + formatted.length);
		if (this.choice.insertAfter?.replaceExisting) {
			const endOfLine = positioning.getInlineEndOfLine(this.fileContent, matchEnd);
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
	private async createInsertAfterIfNotFound(formatted: string, insertAfterLine: string) {
		const settings = this.choice.insertAfter;
		if (settings?.createIfNotFoundLocation === CREATE_IF_NOT_FOUND_ORDERED) {
			return this.createInsertAfterOrdered(formatted, insertAfterLine);
		}
		const payload = `${insertAfterLine}\n${formatted}`;
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
						lines, end ?? lines.length - 1, this.fileContent, payload,
					);
				}
				return this.insertTextAfterPositionInBody(payload, this.fileContent, position);
			},
		});
	}

	/** Place missing headings among same-level siblings using the first anchor line; non-headings fall back to TOP. */
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

	private createInsertAfterOrdered(
		formatted: string,
		targetString: string,
	): string {
		const orderBy = this.choice.insertAfter?.orderBy ?? {
			by: "insertion" as const,
			direction: "desc" as const,
			unparseable: "bottom" as const,
		};

		const firstLine = targetString.split(/\r?\n/, 1)[0];
		const level = getMarkdownHeadings([firstLine])[0]?.level ?? 0;

		// Reused verbatim so the created block is byte-identical to next-run's search
		// target (the #742 round-trip invariant that keeps creation idempotent).
		const payload = `${targetString}\n${formatted}`;

		// Non-heading anchor: ordered placement is meaningless → graceful TOP degrade.
		if (level === 0) {
			return this.insertAtNoteBodyStartTracking(payload);
		}

		// CRLF-safe line model: the helper detects headings on \r-stripped lines;
		// the splice happens on the original lines to preserve EOL bytes.
		const rawLines = getLinesInString(this.fileContent);
		const lines = rawLines.map((line) => line.replace(/\r$/, ""));

		// Exclude any YAML frontmatter so a `#`-prefixed YAML line is never treated
		// as a sibling/ancestor and the new section can never be spliced into the
		// frontmatter block (frontmatter detection mirrors insertAtNoteBodyStart).
		const bodyStartLine = positioning.getBodyStartLine(this.fileContent);

		// Idempotency guard for multi-line anchors: the block search (findInsertAfterRange)
		// matches the WHOLE multi-line target, so a target like "## 2026-06-16\n**Tasks**"
		// is "not found" when the note already has a bare "## 2026-06-16" without the
		// **Tasks** line — which would otherwise create a DUPLICATE heading here. When the
		// heading line itself already exists in the body, insert the content under it
		// instead (top of section, or section end when insertAtEnd), never duplicating.
		// Match against fence-masked lines so a `## …` inside a code block is not
		// mistaken for a real heading (consistent with computeOrderedSectionInsertIndex).
		const maskedLines = maskFencedHeadings(lines);
		const headingNeedle = firstLine.replace(/\r$/, "").trimEnd();
		const existingHeadingLine = maskedLines.findIndex(
			(line, i) => i >= bodyStartLine && line.trimEnd() === headingNeedle,
		);
		if (existingHeadingLine !== -1) {
			const position = this.choice.insertAfter?.insertAtEnd
				? positioning.findInsertAfterPositionAtSectionEnd(
						maskedLines,
						getEndOfSection(
							maskedLines,
							existingHeadingLine,
							this.considerSubsectionsForAnchor(
								maskedLines,
								existingHeadingLine,
							),
						) ?? maskedLines.length - 1,
						this.fileContent,
						formatted,
					)
				: positioning.findInsertAfterPositionWithBlankLines(
						maskedLines,
						existingHeadingLine,
						this.fileContent,
						this.choice.insertAfter?.blankLineAfterMatchMode ?? "auto",
					);
			return this.insertTextAfterPositionInBody(
				formatted,
				this.fileContent,
				position,
			);
		}

		const moment =
			typeof window !== "undefined"
				? (window.moment as unknown as MomentLike | undefined)
				: undefined;
		const slot = computeOrderedSectionInsertIndex(
			lines,
			firstLine,
			level,
			orderBy,
			moment,
			bodyStartLine,
		);

		if (slot.mode === "bodyStart") {
			return this.insertAtNoteBodyStartTracking(payload);
		}

		return this.spliceOrderedSection(rawLines, slot, payload);
	}

	/**
	 * Adapter: splices a created ordered section into this run's file content and
	 * records the cursor end offset. Positioning logic lives in
	 * {@link positioning.spliceOrderedSection}.
	 */
	private spliceOrderedSection(
		rawLines: string[],
		slot: Exclude<OrderedSlot, { mode: "bodyStart" }>,
		payload: string,
	): string {
		const { content, insertedEndOffset } = positioning.spliceOrderedSection(
			rawLines,
			slot,
			payload,
			this.fileContent,
		);
		this.setCaptureInsertionEndOffset(insertedEndOffset);
		return content;
	}
	private async createInsertBeforeIfNotFound(formatted: string, insertBeforeLine: string) {
		const settings = this.choice.insertBefore;
		if (!settings) throw new ChoiceAbortError("Insert-before settings are missing.");
		const payload = formatted.endsWith("\n") || formatted.length === 0
			? `${formatted}${insertBeforeLine}`
			: `${formatted}\n${insertBeforeLine}`;
		return this.createMissingTarget({
			payload,
			location: settings.createIfNotFoundLocation,
			rawTarget: settings.before,
			cursorOffsetInText: formatted.length,
			insertAtCursor: (line) => this.insertTextBeforePositionInBody(
				payload, this.fileContent, line, formatted.length,
			),
		});
	}
	private async createInlineInsertAfterIfNotFound(formatted: string, targetString: string): Promise<string> {
		const payload = `${targetString}${formatted}`;
		return this.createMissingTarget({
			payload,
			location: this.choice.insertAfter?.createIfNotFoundLocation,
			rawTarget: this.choice.insertAfter.after,
			insertAtCursor: (line) => this.insertTextAfterPositionInBody(payload, this.fileContent, line),
		});
	}

	/** All create modes share placement and errors; each keeps its cursor insertion semantics. */
	private createMissingTarget({ payload, location, rawTarget, cursorOffsetInText = payload.length, insertAtCursor }: {
		payload: string;
		location: string | undefined;
		rawTarget: string;
		cursorOffsetInText?: number;
		insertAtCursor: (line: number) => string;
	}): string {
		switch (location) {
			case CREATE_IF_NOT_FOUND_TOP:
				return this.insertAtNoteBodyStartTracking(payload, cursorOffsetInText);
			case CREATE_IF_NOT_FOUND_BOTTOM:
				this.setCaptureInsertionEndOffset(this.fileContent.length + 1 + cursorOffsetInText);
				return `${this.fileContent}\n${payload}`;
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

	private insertAtNoteBodyStartTracking(
		text: string,
		cursorOffsetInText = text.length,
	): string {
		const result = insertAtNoteBodyStartWithResult(this.fileContent, text);
		if (result.insertedStartOffset === null) {
			this.setCaptureInsertionEndOffset(null);
			return result.content;
		}

		const clampedOffset = Math.max(
			0,
			Math.min(cursorOffsetInText, text.length),
		);
		this.setCaptureInsertionEndOffset(
			result.insertedStartOffset + clampedOffset,
		);
		return result.content;
	}

	/** Adapter: binds this run's task flag, records the cursor end offset. */
	private insertTextAfterPositionInBody(
		rawText: string,
		body: string,
		pos: number,
	): string {
		const { content, insertedEndOffset } =
			positioning.insertTextAfterPositionInBody(
				rawText,
				body,
				pos,
				!!this.choice.task,
			);
		this.setCaptureInsertionEndOffset(insertedEndOffset);
		return content;
	}

	/** Adapter: records the cursor end offset around the pure helper. */
	private insertTextBeforePositionInBody(
		text: string,
		body: string,
		pos: number,
		cursorOffsetInText = text.length,
	): string {
		const { content, insertedEndOffset } =
			positioning.insertTextBeforePositionInBody(
				text,
				body,
				pos,
				cursorOffsetInText,
			);
		this.setCaptureInsertionEndOffset(insertedEndOffset);
		return content;
	}
}
