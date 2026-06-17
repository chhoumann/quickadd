import { MarkdownView, type TFile } from "obsidian";
import { getLinesInString } from "src/utility";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_ORDERED,
	CREATE_IF_NOT_FOUND_TOP,
} from "../constants";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { BlankLineAfterMatchMode } from "../types/choices/ICaptureChoice";
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
import {
	getBodyStartOffset,
	insertAtNoteBodyStart,
} from "../utils/noteContentInsertion";
import { parentFolderPath } from "../utils/pathUtils";

/**
	* Only ASCII whitespace counts as "nothing to capture". Unicode spaces such as
	* the non-breaking space (U+00A0) are intentional content and must not be
	* dropped, even though String.prototype.trim() strips them (issue #760).
	*/
const ASCII_WHITESPACE_ONLY_REGEX = /^[ \t\r\n\f\v]*$/;
const IMAGE_CLIPBOARD_MIME_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
};

function isCaptureContentEmpty(content: string): boolean {
	return ASCII_WHITESPACE_ONLY_REGEX.test(content);
}

export class CaptureChoiceFormatter extends CompleteFormatter {
	private choice: ICaptureChoice;
	private file: TFile | null = null;
	private fileContent = "";
	private sourcePath: string | null = null;
	private useSelectionAsCaptureValue = true;
	private clipboardAttachmentLink: string | null | undefined;
	/**
		* Tracks whether the current formatter instance has already run Templater on the
		* capture payload.  This prevents the same content from being parsed twice in
		* multi-stage formatting flows (see issue #533 – double execution when using
		* tp.system.prompt).
		*/
	private templaterProcessed = false;
	/**
		* When set (by the engine's "Choose heading when capturing" picker), this verbatim
		* file line replaces the static `insertAfter.after` target for this run. It is a
		* concrete line copied from the destination file (`lines[heading.line]`), so it is
		* matched LITERALLY — `formatLocationString`/escape-expansion are deliberately
		* skipped so a heading whose text contains token-like syntax (e.g. `## {{date}}`)
		* is not resolved and desynced from the real line. The engine + its single
		* formatter are constructed fresh per run, so this never leaks across captures.
		*/
	private insertAfterTargetOverride: string | null = null;
	/**
	 * The resolved first-line heading of the insert-after target for this run
	 * (e.g. `## 2026-06-16`, leading `#`s kept), captured once the token-driven
	 * `after` string is resolved. The engine reads it (via
	 * getResolvedInsertAfterHeading) to show `Captured to X under '## 2026-06-16'`
	 * instead of the raw `{{DATE:…}}` token in the success notice for ordered
	 * captures. Null until the non-inline/non-override block path resolves a
	 * heading target.
	 */
	private lastResolvedInsertAfterHeading: string | null = null;
	/**
		* Tracks whether `\n` escapes in the capture format string have been expanded.
		* Expansion must happen on the raw format template BEFORE token substitution,
		* and only once per capture run: multi-stage flows pass already-substituted
		* content back into formatFileContent, and backslash sequences inside captured
		* content (selection, clipboard, prompt input) must survive verbatim — e.g.
		* capturing the LaTeX selection `\nabla` must not turn into a linebreak + "abla"
		* (issue #527).
		*/
	private linebreaksProcessed = false;

	public setDestinationFile(file: TFile): void {
		this.file = file;
		this.sourcePath = file.path;
		// {{FOLDER}} in a capture body resolves to the destination file's folder.
		this.setTargetFolderPath(parentFolderPath(file.path));
	}

	public setDestinationSourcePath(path: string): void {
		this.sourcePath = path;
		this.file = null;
		this.setTargetFolderPath(parentFolderPath(path));
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

	/**
	 * The resolved insert-after heading line for this run, leading `#`s KEPT (e.g.
	 * `## 2026-06-16`), or null if the target was not a resolved heading. Used by
	 * the engine's success notice for ordered captures (see
	 * lastResolvedInsertAfterHeading). The `#` form matches the notice's raw-token
	 * fallback; do not strip it here without aligning the promptHeading path.
	 */
	public getResolvedInsertAfterHeading(): string | null {
		return this.lastResolvedInsertAfterHeading;
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
		if (text.length > 0) return text;

		if (this.clipboardAttachmentLink !== undefined) {
			return this.clipboardAttachmentLink ?? "";
		}

		this.clipboardAttachmentLink = await this.saveClipboardImageAsAttachment();
		return this.clipboardAttachmentLink ?? "";
	}

	private async saveClipboardImageAsAttachment(): Promise<string | null> {
		const clipboard = navigator.clipboard as Clipboard & {
			read?: () => Promise<ClipboardItem[]>;
		};
		if (typeof clipboard?.read !== "function") {
			return null;
		}

		try {
			const item = await this.getFirstClipboardImageItem(clipboard);
			if (!item) return null;

			const blob = await item.clipboardItem.getType(item.mimeType);
			const extension = IMAGE_CLIPBOARD_MIME_EXTENSIONS[item.mimeType];
			const filename = `Clipboard image ${this.formatAttachmentTimestamp(new Date())}.${extension}`;
			const attachmentPath =
				await this.app.fileManager.getAvailablePathForAttachment(
					filename,
					this.getLinkSourcePath() ?? undefined,
				);
			const file = await this.app.vault.createBinary(
				attachmentPath,
				await blob.arrayBuffer(),
			);
			const link = this.app.fileManager.generateMarkdownLink(
				file,
				this.getLinkSourcePath() ?? "",
			);

			return link.startsWith("!") ? link : `!${link}`;
		} catch {
			return null;
		}
	}

	private async getFirstClipboardImageItem(clipboard: {
		read: () => Promise<ClipboardItem[]>;
	}): Promise<{ clipboardItem: ClipboardItem; mimeType: string } | null> {
		const items = await clipboard.read();
		for (const clipboardItem of items) {
			const mimeType = clipboardItem.types.find(
				(type) => IMAGE_CLIPBOARD_MIME_EXTENSIONS[type] !== undefined,
			);
			if (mimeType) {
				return { clipboardItem, mimeType };
			}
		}

		return null;
	}

	private formatAttachmentTimestamp(date: Date): string {
		const pad = (value: number) => String(value).padStart(2, "0");
		return [
			date.getFullYear(),
			pad(date.getMonth() + 1),
			pad(date.getDate()),
		].join("-") + ` ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
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
		let formatted = await super.formatFileContent(
			await this.expandTemplateLinebreaksOnce(input),
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
		return insertAtNoteBodyStart(this.fileContent, formatted);
	}

	async formatContentOnly(input: string): Promise<string> {
		// Process the input with templater (if needed) at this stage
		// This is the first pass where we want to run any templater code
		const formatted = await super.formatFileContent(
			await this.expandTemplateLinebreaksOnce(input),
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

	/**
		* Expands linebreak escapes on format-template text. Global variable
		* snippets are format-template material — the docs promise they are
		* "processed by the usual formatter passes" — so they must be injected
		* before linebreak expansion. The second global-var expansion inside
		* format() is a no-op since no {{GLOBAL_VAR}} tokens remain.
		*/
	private async expandFormatTemplateEscapes(template: string): Promise<string> {
		const withGlobals = await this.replaceGlobalVarInString(template);
		return this.expandLinebreakEscapesOutsideTokens(withGlobals);
	}

	/**
	 * Splits a fully-expanded insert target into the anchor lines used for
	 * matching. `\n` escapes in the target have already been turned into real
	 * newlines (symmetric with the create-if-not-found path, which writes the
	 * same expansion to disk), so a multi-line target like `**Today**\n***`
	 * becomes `["**Today**", "***"]`.
	 *
	 * Trailing blank lines come from a trailing `\n` escape and are not part of
	 * the anchor, so they are dropped: `**Today**\n` and `**Today**\n\n` both
	 * collapse to the single-line anchor `["**Today**"]`. Interior blank lines
	 * are preserved so a `## D\n\n**Tasks**` anchor still requires the blank.
	 */
	private toTargetLines(expandedTarget: string): string[] {
		const lines = expandedTarget.split("\n");
		while (lines.length > 1 && lines[lines.length - 1].trim() === "") {
			lines.pop();
		}
		return lines;
	}

	private isBlankTarget(targetLines: string[]): boolean {
		return (
			targetLines.length === 0 ||
			(targetLines.length === 1 && targetLines[0].trim() === "")
		);
	}

	/**
	 * Locates the insert target in the file. Returns the inclusive line range
	 * `{ start, end }` the target occupies, or `{ start: -1, end: -1 }` when not
	 * found. For a single-line target `start === end`, preserving historical
	 * single-line behavior exactly. Callers pick which boundary to anchor on:
	 * insert-after-immediate uses `end`, insert-before uses `start`,
	 * insert-after-at-end derives the section end from `start` (issue #742).
	 */
	private findInsertAfterRange(
		lines: string[],
		targetLines: string[],
	): { start: number; end: number } {
		if (targetLines.length <= 1) {
			const start = this.findSingleLineIndex(lines, targetLines[0] ?? "");
			return { start, end: start };
		}
		return this.findMultiLineRange(lines, targetLines);
	}

	private findSingleLineIndex(lines: string[], rawTarget: string): number {
		// `\n` escapes are already expanded upstream, so no escape stripping
		// happens here — stripping would desync search from the create path,
		// which writes the unstripped string (issue #742).
		const target = rawTarget.trimEnd();
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

	/**
	 * Matches a multi-line target as a consecutive run of file lines. Only
	 * TRAILING whitespace is stripped before comparison (on both sides), which
	 * normalizes CRLF carriage returns and trailing spaces while preserving
	 * LEADING indentation — `  - Parent\n    - Child` must not match a flat
	 * `- Parent\n- Child`. Because the create path writes the target verbatim,
	 * an indented anchor still round-trips. No fuzzy/partial fallback: a
	 * multi-line anchor must match verbatim to avoid false positives.
	 */
	private findMultiLineRange(
		lines: string[],
		targetLines: string[],
	): { start: number; end: number } {
		const n = targetLines.length;
		const normalizedTargets = targetLines.map((line) =>
			this.stripTrailingWhitespace(line),
		);

		for (let i = 0; i + n <= lines.length; i++) {
			let matched = true;
			for (let k = 0; k < n; k++) {
				if (this.stripTrailingWhitespace(lines[i + k]) !== normalizedTargets[k]) {
					matched = false;
					break;
				}
			}
			if (matched) return { start: i, end: i + n - 1 };
		}

		return { start: -1, end: -1 };
	}

	private stripTrailingWhitespace(line: string): string {
		return line.replace(/\s+$/, "");
	}

	/**
	 * `considerSubsections` only has meaning for a heading anchor — a non-heading
	 * line has no section whose subsections could be included, and
	 * getEndOfSection() throws if asked to consider subsections of a non-heading
	 * line. Multi-line anchors made non-heading start lines newly matchable
	 * (issue #742), so degrade to false when the anchor is not a heading
	 * (using getEndOfSection's own heading definition) instead of throwing.
	 */
	private considerSubsectionsForAnchor(
		lines: string[],
		anchorLine: number,
	): boolean {
		if (!this.choice.insertAfter?.considerSubsections) return false;
		return getMarkdownHeadings([lines[anchorLine] ?? ""]).length > 0;
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
		fileContent: string,
		insertedText: string,
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

		// For entries without trailing newline, keep insertion anchored at the
		// section end so repeated captures preserve order.
		if (!insertedText.endsWith("\n")) {
			return sectionEndIndex;
		}

		// split("\n") keeps a trailing empty string when content ends in "\n".
		// We keep one trailing slot so the next insertion preserves capture spacing
		// without introducing an extra blank line before the inserted text.
		if (fileContent.endsWith("\n")) {
			return Math.max(sectionEndIndex, position - 1);
		}

		return position;
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

		const targetLines = this.toTargetLines(targetString);
		if (this.isBlankTarget(targetLines)) {
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
			? this.maskNonBodyHeadingsForSearch(fileContentLines)
			: fileContentLines;
		const { start, end } = this.findInsertAfterRange(searchLines, targetLines);
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

			targetPosition = this.findInsertAfterPositionAtSectionEnd(
				fileContentLines,
				sectionEnd,
				this.fileContent,
				formatted,
			);
		} else {
			const blankLineMode =
				this.choice.insertAfter?.blankLineAfterMatchMode ?? "auto";
			// Insert after the block's last line; blank-line skipping keys off it.
			targetPosition = this.findInsertAfterPositionWithBlankLines(
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

		const targetLines = this.toTargetLines(targetString);
		if (this.isBlankTarget(targetLines)) {
			throw new ChoiceAbortError(
				"Insert-before target is empty after formatting.",
			);
		}

		const fileContentLines: string[] = getLinesInString(this.fileContent);
		// Insert-before anchors on the block's FIRST line so the capture lands
		// before the whole multi-line anchor (never inside it — issue #742).
		const { start } = this.findInsertAfterRange(fileContentLines, targetLines);
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

	private async createInsertAfterIfNotFound(
		formatted: string,
		insertAfterLine: string,
	) {
		// `insertAfterLine` is the resolved+escape-expanded target already computed
		// by insertAfterHandler. Reusing it (rather than re-deriving) guarantees the
		// created block is byte-identical to what the search will look for on the
		// next run, which is the actual fix for the duplication (issues #742, #527).
		const insertAfterLineAndFormatted = `${insertAfterLine}\n${formatted}`;

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_TOP
		) {
			return insertAtNoteBodyStart(
				this.fileContent,
				insertAfterLineAndFormatted,
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
						this.considerSubsectionsForAnchor(fileContentLines, targetPosition),
					);

					targetPosition = this.findInsertAfterPositionAtSectionEnd(
						fileContentLines,
						endOfSectionIndex ?? fileContentLines.length - 1,
						this.fileContent,
						insertAfterLineAndFormatted,
					);
				}

				const newFileContent = this.insertTextAfterPositionInBody(
					insertAfterLineAndFormatted,
					this.fileContent,
					targetPosition,
				);

				return newFileContent;
			} catch {
				throw new ChoiceAbortError(
					`Unable to insert line '${this.choice.insertAfter.after}' at cursor position.`,
				);
			}
		}

		if (
			this.choice.insertAfter?.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_ORDERED
		) {
			return this.createInsertAfterOrdered(formatted, insertAfterLine);
		}

		throw new ChoiceAbortError(
			`Unknown createIfNotFoundLocation: ${this.choice.insertAfter?.createIfNotFoundLocation}`,
		);
	}

	/**
	 * Create a missing insert-after heading at its sorted position among same-level
	 * siblings (the "ordered" create-if-not-found location, issue #481). The
	 * heading level and sort key come from the FIRST line of a (possibly multi-line
	 * #742) anchor; CRLF is stripped for the line model, then re-applied on splice.
	 * A non-heading anchor has no sibling band, so it degrades gracefully to the
	 * existing TOP behavior (parity with considerSubsectionsForAnchor).
	 */
	/** True when this capture uses the ordered create-if-not-found location. */
	private isOrderedCreate(): boolean {
		return (
			!!this.choice.insertAfter?.createIfNotFound &&
			this.choice.insertAfter?.createIfNotFoundLocation ===
				CREATE_IF_NOT_FOUND_ORDERED
		);
	}

	/**
	 * Index of the first body line after any YAML frontmatter (0 when none).
	 * Mirrors insertAtNoteBodyStart's frontmatter detection (getBodyStartOffset).
	 */
	private getBodyStartLine(): number {
		const bodyStartOffset = getBodyStartOffset(this.fileContent);
		return bodyStartOffset > 0
			? this.fileContent.slice(0, bodyStartOffset).split("\n").length - 1
			: 0;
	}

	/**
	 * Returns CRLF-stripped lines with frontmatter lines blanked and fenced-code
	 * headings neutralized, so the ordered target search never matches a heading
	 * that isn't a real body section. Line indices are preserved.
	 */
	private maskNonBodyHeadingsForSearch(lines: string[]): string[] {
		const bodyStartLine = this.getBodyStartLine();
		const masked = maskFencedHeadings(lines).map((line) =>
			line.replace(/\r$/, ""),
		);
		for (let i = 0; i < bodyStartLine && i < masked.length; i++) {
			masked[i] = "";
		}
		return masked;
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
			return insertAtNoteBodyStart(this.fileContent, payload);
		}

		// CRLF-safe line model: the helper detects headings on \r-stripped lines;
		// the splice happens on the original lines to preserve EOL bytes.
		const rawLines = getLinesInString(this.fileContent);
		const lines = rawLines.map((line) => line.replace(/\r$/, ""));

		// Exclude any YAML frontmatter so a `#`-prefixed YAML line is never treated
		// as a sibling/ancestor and the new section can never be spliced into the
		// frontmatter block (frontmatter detection mirrors insertAtNoteBodyStart).
		const bodyStartLine = this.getBodyStartLine();

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
				? this.findInsertAfterPositionAtSectionEnd(
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
				: this.findInsertAfterPositionWithBlankLines(
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
			return insertAtNoteBodyStart(this.fileContent, payload);
		}

		return this.spliceOrderedSection(rawLines, slot, payload);
	}

	/**
	 * Splice a created section at the resolved slot, padding it with a single blank
	 * line above the heading (when the preceding line is non-blank) and below the
	 * block (when the following line is non-blank) so the heading is never glued to
	 * neighbouring content (the helpers QuickAdd ships do not pad headings —
	 * verified — so this is the dedicated separation path for ordered creation).
	 *
	 * Byte-preserving: the original `fileContent` is sliced at the insertion offset
	 * and the existing text on both sides is kept VERBATIM (so a mixed-EOL note is
	 * never wholesale-normalized — an ordered capture produces a minimal diff). Only
	 * the inserted block and its two seams use the file's dominant EOL. The offset
	 * is derived from `rawLines` (which `getLinesInString` produced by splitting on
	 * "\n", so each prior line consumed its own length + 1 for the "\n"). `\r` is
	 * stripped only for the blank-line trim checks.
	 */
	private spliceOrderedSection(
		rawLines: string[],
		slot: Exclude<OrderedSlot, { mode: "bodyStart" }>,
		payload: string,
	): string {
		const content = this.fileContent;
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		const insertIdx = slot.mode === "before" ? slot.line : slot.line + 1;

		// Character offset of the start of line `insertIdx` in the original content.
		let offset = 0;
		for (let i = 0; i < insertIdx && i < rawLines.length; i++) {
			offset += rawLines[i].length + 1; // +1 for the consumed "\n"
		}
		if (offset > content.length) offset = content.length;
		const before = content.slice(0, offset);
		const after = content.slice(offset);

		const prev =
			insertIdx > 0 ? (rawLines[insertIdx - 1] ?? "").replace(/\r$/, "") : "";
		const next =
			insertIdx < rawLines.length
				? (rawLines[insertIdx] ?? "").replace(/\r$/, "")
				: "";

		const payloadLines = payload.split("\n").map((line) => line.replace(/\r$/, ""));
		// Drop a single trailing empty line that a format ending in "\n" produces, so
		// separation is controlled solely by the padding below.
		if (payloadLines.length > 1 && payloadLines[payloadLines.length - 1] === "") {
			payloadLines.pop();
		}

		const blockLines: string[] = [];
		if (insertIdx > 0 && prev.trim() !== "") blockLines.push(""); // blank above heading
		blockLines.push(...payloadLines);
		if (insertIdx < rawLines.length && next.trim() !== "") blockLines.push(""); // blank below block

		const blockText = blockLines.join(eol);
		// Terminate the preceding line when `before` doesn't already end with a
		// newline (the EOF-without-trailing-newline case), and terminate the block
		// when content follows it OR when the file already ended with a newline (so
		// appending at EOF preserves the file's trailing newline). Existing bytes in
		// before/after stay verbatim.
		const lead = before.length > 0 && !/\n$/.test(before) ? eol : "";
		const trail =
			after.length > 0 || /\n$/.test(content) ? eol : "";
		return `${before}${lead}${blockText}${trail}${after}`;
	}

	private async createInsertBeforeIfNotFound(
		formatted: string,
		insertBeforeLine: string,
	) {
		const insertBefore = this.choice.insertBefore;
		if (!insertBefore) {
			throw new ChoiceAbortError("Insert-before settings are missing.");
		}

		// `insertBeforeLine` is the resolved+escape-expanded target from
		// insertBeforeHandler, reused so create and search stay byte-identical.
		const formattedAndInsertBeforeLine =
			formatted.endsWith("\n") || formatted.length === 0
				? `${formatted}${insertBeforeLine}`
				: `${formatted}\n${insertBeforeLine}`;

		if (
			insertBefore.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_TOP
		) {
			return insertAtNoteBodyStart(
				this.fileContent,
				formattedAndInsertBeforeLine,
			);
		}

		if (
			insertBefore.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_BOTTOM
		) {
			return `${this.fileContent}\n${formattedAndInsertBeforeLine}`;
		}

		if (
			insertBefore.createIfNotFoundLocation ===
			CREATE_IF_NOT_FOUND_CURSOR
		) {
			try {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

				if (!activeView) {
					throw new Error("No active view.");
				}

				const cursor = activeView.editor.getCursor();

				return this.insertTextBeforePositionInBody(
					formattedAndInsertBeforeLine,
					this.fileContent,
					cursor.line,
				);
			} catch {
				throw new ChoiceAbortError(
					`Unable to insert line '${insertBefore.before}' at cursor position.`,
				);
			}
		}

		throw new ChoiceAbortError(
			`Unknown createIfNotFoundLocation: ${insertBefore.createIfNotFoundLocation}`,
		);
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
			return insertAtNoteBodyStart(
				this.fileContent,
				insertAfterLineAndFormatted,
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
			} catch {
				throw new ChoiceAbortError(
					`Unable to insert line '${this.choice.insertAfter.after}' at cursor position.`,
				);
			}
		}

		throw new ChoiceAbortError(
			`Unknown createIfNotFoundLocation: ${this.choice.insertAfter?.createIfNotFoundLocation}`,
		);
	}

	private insertTextAfterPositionInBody(
		rawText: string,
		body: string,
		pos: number,
	): string {
		// Line-matched insertAfter callers always pass a real line index (>= 0); the
		// frontmatter-aware "top" insertion lives in insertAtNoteBodyStart instead.
		// Shared by every "after" path: the line-matched handler, insert-at-end-of-
		// section, and the create-if-not-found cursor paths.
		const splitContent = body.split("\n");
		const pre = splitContent.slice(0, pos + 1).join("\n");
		const post = splitContent.slice(pos + 1).join("\n");

		// "Format as task" injects a trailing newline onto the capture content
		// (getCaptureContent in CaptureChoiceEngine) so a bare task is always a
		// complete line. When the line directly below the insertion point is already
		// blank, that injected newline stacks on top of the existing blank line and
		// renders a spurious blank line AFTER the task (issue #312) — an asymmetry
		// the user does not see without the task option. Drop the redundant injected
		// newline in that case; the existing blank line still separates the task from
		// the following content. A user-typed trailing newline in the format string
		// is intentional content and is left untouched (gated on choice.task, this
		// only collapses QuickAdd's own injected task newline).
		//
		// Detect the blank line via the split index, not `post.startsWith("\n")`, so
		// whitespace-only and CRLF blanks (where the line is "\r" or "   ", not "")
		// are recognised too. When `body` ends in a newline, split() appends a
		// trailing empty slot that is the EOF artifact, not a real blank line, so it
		// must not trigger the drop; a body WITHOUT a trailing newline has no such
		// artifact, so its final slot is a genuine (possibly blank) last line.
		const lineBelow = splitContent[pos + 1];
		const isTrailingNewlineArtifact =
			body.endsWith("\n") && pos + 1 === splitContent.length - 1;
		const blankLineDirectlyBelow =
			pos + 1 < splitContent.length &&
			!isTrailingNewlineArtifact &&
			(lineBelow ?? "").trim() === "";
		const text =
			this.choice.task && rawText.endsWith("\n") && blankLineDirectlyBelow
				? rawText.slice(0, -1)
				: rawText;

		return `${pre}\n${text}${post}`;
	}

	private insertTextBeforePositionInBody(
		text: string,
		body: string,
		pos: number,
	): string {
		const separator = body.length > 0 && !text.endsWith("\n") ? "\n" : "";

		if (pos <= 0) {
			return `${text}${separator}${body}`;
		}

		const splitContent = body.split("\n");
		const pre = splitContent.slice(0, pos).join("\n");
		const post = splitContent.slice(pos).join("\n");

		return `${pre}\n${text}${separator}${post}`;
	}
}
