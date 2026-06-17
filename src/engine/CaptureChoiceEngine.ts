import {
	MarkdownView,
	Notice,
	TFile,
	type App,
	type WorkspaceLeaf,
} from "obsidian";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import { renderNotePathSuggestion } from "src/gui/InputSuggester/renderNotePathSuggestion";
import { orderFilesForPicker } from "src/utils/fileOrdering";
import { buildPickerOrderingDeps } from "src/utils/pickerOrderingDeps";
import invariant from "src/utils/invariant";
import merge from "three-way-merge";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	CREATE_IF_NOT_FOUND_ORDERED,
	MARKDOWN_FILE_EXTENSION_REGEX,
	QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
	VALUE_SYNTAX,
} from "../constants";
import { CaptureChoiceFormatter } from "../formatters/captureChoiceFormatter";
import { getMarkdownHeadings } from "../formatters/helpers/getEndOfSection";
import { getLinesInString } from "../utility";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { normalizeAppendLinkOptions, type AppendLinkOptions } from "../types/linkPlacement";
import {
	appendToCurrentLine,
	getMarkdownFilesInFolder,
	getMarkdownFilesWithTag,
	getMarkdownFilesWithProperty,
	insertFileLinkToActiveView,
	insertOnNewLineAbove,
	insertOnNewLineBelow,
	isTemplaterTriggerOnCreateEnabled,
	jumpToNextTemplaterCursorIfPossible,
	isFolder,
	openExistingFileTab,
	openFile,
	overwriteTemplaterOnce,
	setMarkdownCursorAtOffset,
	templaterParseTemplate,
	waitForTemplaterTriggerOnCreateToComplete,
} from "../utilityObsidian";
import { isCancellationError, reportError } from "../utils/errorUtils";
import { parsePropertyTarget } from "../utils/propertyTarget";
import type { FieldFilter } from "../utils/FieldSuggestionParser";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { basenameWithoutMdOrCanvas, parentFolderPath } from "../utils/pathUtils";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
import {
	postProcessFrontMatter,
	shouldPostProcessFrontMatter,
} from "./helpers/frontmatterPostProcessor";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import { SingleTemplateEngine } from "./SingleTemplateEngine";
import { getCaptureAction, type CaptureAction } from "./captureAction";
import {
	getCanvasTextCaptureContent,
	resolveActiveCanvasCaptureTarget,
	resolveConfiguredCanvasCaptureTarget,
	setCanvasTextCaptureContent,
	type CanvasTextCaptureTarget,
	type ConfiguredCanvasCaptureTarget,
} from "./canvasCapture";
import { handleMacroAbort } from "../utils/macroAbortHandler";

const DEFAULT_NOTICE_DURATION = 4000;

type CaptureWriteResult = {
	file: TFile;
	newFileContent: string;
	captureContent: string;
	cursorEndOffset?: number;
	cursorPlacementSafe?: boolean;
};

export class CaptureChoiceEngine extends QuickAddChoiceEngine {
	choice: ICaptureChoice;
	private formatter: CaptureChoiceFormatter;
	private readonly plugin: QuickAdd;
	private templatePropertyVars?: Map<string, unknown>;
	private capturePropertyVars: Map<string, unknown> = new Map();
	// Set per run: true when the capture content lands in a note BODY (any capture
	// into an existing file, into a template's body, or an editor insertion) rather
	// than becoming the file's own front matter. Front matter property collection is
	// suppressed in that case so collected containers aren't stranded as "[]"
	// placeholders (and written to the wrong note's front matter). See run().
	private suppressFrontmatterCollection = false;
	// Set when the "Choose heading when capturing" picker resolves a heading. Holds the heading
	// TEXT (without '#' markers) for the success notice; the verbatim line goes to the
	// formatter override. Null when not in heading mode.
	private resolvedInsertAfterHeading: string | null = null;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ICaptureChoice,
		private choiceExecutor: IChoiceExecutor,
		private readonly originLeaf: WorkspaceLeaf | null = null,
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.formatter = new CaptureChoiceFormatter(app, plugin, choiceExecutor);
	}

	/**
	 * For ordered captures (the "ordered" create-if-not-found location), copy the
	 * formatter's resolved insert-after heading (e.g. `## 2026-06-16`) so the
	 * success notice names the real heading instead of the raw `{{DATE:…}}` token.
	 * Called after the format pass; a no-op for every other capture (so existing
	 * insert-after notice behaviour is unchanged).
	 */
	private captureResolvedOrderedHeading(): void {
		if (
			this.choice.insertAfter?.enabled &&
			this.choice.insertAfter.createIfNotFoundLocation ===
				CREATE_IF_NOT_FOUND_ORDERED
		) {
			const resolved = this.formatter.getResolvedInsertAfterHeading();
			if (resolved) this.resolvedInsertAfterHeading = resolved;
		}
	}

	private showSuccessNotice(
		file: TFile,
		{ wasNewFile, action }: { wasNewFile: boolean; action: CaptureAction },
	) {
		const fileName = `'${file.basename}'`;

		if (wasNewFile) {
			new Notice(
				`Created and captured to ${fileName}`,
				DEFAULT_NOTICE_DURATION,
			);
			return;
		}

		const shouldAppendToBottom =
			this.choice.prepend ||
			(this.choice.captureToActiveFile &&
				this.choice.activeFileWritePosition === "bottom");

		let msg = "";
		switch (action) {
			case "currentLine":
				msg = `Captured to current line in ${fileName}`;
				break;
			case "newLineAbove":
				msg = `Captured on a new line above cursor in ${fileName}`;
				break;
			case "newLineBelow":
				msg = `Captured on a new line below cursor in ${fileName}`;
				break;
			case "activeFileTop":
				msg = `Captured to top of ${fileName}`;
				break;
			case "prepend":
			case "append":
				msg = shouldAppendToBottom
					? `Captured to bottom of ${fileName}`
					: `Captured to top of ${fileName}`;
				break;
			case "insertAfter": {
				const heading =
					this.resolvedInsertAfterHeading ?? this.choice.insertAfter.after;
				msg = heading
					? `Captured to ${fileName} under '${heading}'`
					: `Captured to ${fileName}`;
				break;
			}
			case "insertBefore": {
				const heading = this.choice.insertBefore?.before;
				msg = heading
					? `Captured to ${fileName} before '${heading}'`
					: `Captured to ${fileName}`;
				break;
			}
			default:
				msg = `Captured to ${fileName}`;
				break;
		}

		new Notice(msg, DEFAULT_NOTICE_DURATION);
	}

	private hasActiveMarkdownCaptureContext(): boolean {
		const hasActiveFile = !!this.app.workspace.getActiveFile();
		const hasActiveMarkdownView =
			!!this.app.workspace.getActiveViewOfType(MarkdownView);
		return hasActiveFile && hasActiveMarkdownView;
	}

	private shouldSkipRequiredCanvasLinkInsertion(
		linkOptions: AppendLinkOptions,
		isCanvasTriggered: boolean,
	): boolean {
		return (
			isCanvasTriggered &&
			linkOptions.requireActiveFile &&
			!this.hasActiveMarkdownCaptureContext()
		);
	}

	private insertCaptureLink(
		file: TFile,
		linkOptions: AppendLinkOptions,
		{ isCanvasTriggered }: { isCanvasTriggered: boolean },
	): void {
		if (!linkOptions.enabled) {
			return;
		}

		if (
			this.shouldSkipRequiredCanvasLinkInsertion(linkOptions, isCanvasTriggered)
		) {
			if (this.plugin.settings.showCaptureNotification) {
				new Notice(
					"Canvas capture skipped link insertion because no Markdown editor is focused.",
					DEFAULT_NOTICE_DURATION,
				);
			}
			return;
		}

		insertFileLinkToActiveView(this.app, file, linkOptions);
	}

	async run(): Promise<void> {
		let contentCommitted = false;
		try {
			// Reset any pending structured values before starting a new capture run
			this.capturePropertyVars.clear();
			const linkOptions = normalizeAppendLinkOptions(this.choice.appendLink);
			this.formatter.setLinkToCurrentFileBehavior(
				linkOptions.enabled && !linkOptions.requireActiveFile
					? "optional"
					: "required",
			);
			const selectionOverride = this.choice.useSelectionAsCaptureValue;
			const globalSelectionAsValue =
				this.plugin.settings.useSelectionAsCaptureValue ?? true;
			const useSelectionAsCaptureValue =
				typeof selectionOverride === "boolean"
					? selectionOverride
					: globalSelectionAsValue;
			this.formatter.setUseSelectionAsCaptureValue(useSelectionAsCaptureValue);

			const action = getCaptureAction(this.choice);
			const isEditorInsertionAction =
				action === "currentLine" ||
				action === "newLineAbove" ||
				action === "newLineBelow";
			const activeCanvasTarget = this.choice.captureToActiveFile
				? resolveActiveCanvasCaptureTarget(this.app, action)
				: null;
			const configuredCanvasTarget =
				await this.resolveConfiguredCanvasTarget(action);
			const canvasTarget = activeCanvasTarget ?? configuredCanvasTarget;

			if (canvasTarget?.kind === "text") {
				await this.handleCanvasTextCapture(
					canvasTarget,
					action,
					linkOptions,
					() => {
						contentCommitted = true;
					},
				);
				return;
			}

			if (
				canvasTarget?.kind === "file" &&
				((action === "insertAfter" &&
					this.choice.insertAfter?.createIfNotFound &&
					this.choice.insertAfter?.createIfNotFoundLocation === "cursor") ||
					(action === "insertBefore" &&
						this.choice.insertBefore?.createIfNotFound &&
						this.choice.insertBefore?.createIfNotFoundLocation === "cursor"))
			) {
				throw new ChoiceAbortError(
					"Canvas file cards do not support creating missing line targets at cursor. Use top or bottom.",
				);
			}

			const filePath =
				canvasTarget?.kind === "file"
					? canvasTarget.source === "configured"
						? canvasTarget.targetFile?.path ?? canvasTarget.targetPath
						: canvasTarget.targetFile.path
					: await this.getFormattedPathToCaptureTo(this.choice.captureToActiveFile);

			if (
				!canvasTarget &&
				!this.choice.captureToActiveFile &&
				CANVAS_FILE_EXTENSION_REGEX.test(filePath)
			) {
				throw new ChoiceAbortError(
					"Capture to a .canvas file requires a target canvas node id.",
				);
			}

			const content = this.getCaptureContent();

			type GetFileAndAddContentFn = (
				path: string,
				capture: string,
				linkOptions?: AppendLinkOptions,
			) => Promise<CaptureWriteResult>;
			let getFileAndAddContentFn: GetFileAndAddContentFn;
			const fileAlreadyExists = await this.fileExists(filePath);

			// "Choose heading when capturing" (After line…): prompt for a heading from the resolved
			// target note and feed the picked line to the formatter as an insert-after
			// override. Runs after the target file is known and before any formatting/write.
			// Canvas TEXT cards are handled earlier in handleCanvasTextCapture (which resolves
			// the heading from the card text); a bare .canvas file path here would be a file
			// card whose underlying note is markdown, so the extension guard is defensive.
			if (
				this.isInsertAfterHeadingMode() &&
				!CANVAS_FILE_EXTENSION_REGEX.test(filePath)
			) {
				await this.maybeResolveInsertAfterHeading(
					await this.readNoteBodyForHeadingPicker(filePath, fileAlreadyExists),
				);
			}

			// Collect front matter property types only when the capture content
			// becomes the file's OWN front matter — i.e. a brand-new file created
			// from the capture with no template. Captures into an existing file
			// (append / bottom / insert-after/before / editor insertion), or into a
			// template's body, place the snippet in the BODY: collecting there would
			// strand a "[]" placeholder in the body AND write the values to the wrong
			// note's front matter. Suppress collection for those.
			const captureBecomesOwnFrontmatter =
				!fileAlreadyExists &&
				!!this.choice?.createFileIfItDoesntExist?.enabled &&
				!this.choice?.createFileIfItDoesntExist?.createWithTemplate;
			this.suppressFrontmatterCollection = !captureBecomesOwnFrontmatter;

			// |multi only yields a real YAML list when its array can be collected
			// into the new note's own front matter. In any other capture shape the
			// array degrades to a comma-joined string; warn instead of silently
			// writing the wrong shape.
			if (
				this.suppressFrontmatterCollection &&
				// Match the `|multi` flag specifically: a pipe, then `multi`
				// terminated by `:`/`|`/`}` or end — excluding `|type:multiline`,
				// `|multi1`, `|multi-select`, etc.
				/\{\{VALUE:[^}]*\|\s*multi(?=[:}|]|$)/i.test(
					this.choice?.format?.format ?? "",
				)
			) {
				log.logWarning(
					"QuickAdd: {{VALUE:…|multi}} in this capture writes a comma-separated string, not a YAML list. Multi-select produces a real list only when capturing into a brand-new note's front matter (Create file if it doesn't exist, without a template).",
				);
			}

			if (fileAlreadyExists) {
				getFileAndAddContentFn =
					this.onFileExists.bind(this) as GetFileAndAddContentFn;
			} else if (this.choice?.createFileIfItDoesntExist?.enabled) {
				getFileAndAddContentFn = ((path, capture, _options) =>
					this.onCreateFileIfItDoesntExist(path, capture, linkOptions)
				) as GetFileAndAddContentFn;
			} else {
				throw new ChoiceAbortError(
					`Target file missing: ${filePath}. Enable "Create file if it doesn't exist" or choose an existing file.`,
				);
			}

			const {
				file,
				newFileContent,
				captureContent,
				cursorEndOffset,
				cursorPlacementSafe = true,
			} =
				await getFileAndAddContentFn(filePath, content);
			let expectedCursorContent: string | null = null;
			let canPlaceCursorAtCapture = cursorPlacementSafe;

			this.captureResolvedOrderedHeading();

			// Handle capture to active file with special actions
			if (isEditorInsertionAction) {
				// Parse Templater syntax in the capture content.
				// If Templater isn't installed, it just returns the capture content.
				const content = await templaterParseTemplate(
					this.app,
					captureContent,
					file,
				);

				let inserted = false;
				switch (action) {
					case "currentLine":
						inserted = appendToCurrentLine(content, this.app);
						break;
					case "newLineAbove":
						inserted = insertOnNewLineAbove(content, this.app);
						break;
					case "newLineBelow":
						inserted = insertOnNewLineBelow(content, this.app);
						break;
				}

				if (!inserted) {
					// No active Markdown editor — the capture did not land. Report a
					// failure instead of falling through to the success notice/callback.
					await this.cleanupCreatedClipboardAttachments();
					InputPromptDraftStore.getInstance().markExecutionScopeFailed();
					log.logError(
						`Capture "${this.choice.name}": no active Markdown editor to insert into.`,
					);
					this.choiceExecutor.recordExecutionResult?.({ status: "error" });
					return;
				}
				contentCommitted = true;
			} else {
				await this.app.vault.modify(file, newFileContent);
				contentCommitted = true;
				if (this.choice.templater?.afterCapture === "wholeFile") {
					await overwriteTemplaterOnce(this.app, file);
					canPlaceCursorAtCapture = false;
				}
				const frontmatterPostProcessed =
					await this.applyCapturePropertyVars(file);
				if (frontmatterPostProcessed) {
					canPlaceCursorAtCapture = false;
				}
				expectedCursorContent = canPlaceCursorAtCapture ? newFileContent : null;
			}

			// Content is committed. Record success BEFORE the cosmetic steps below
			// (notice / link / open / cursor jump) so a later cosmetic failure cannot
			// downgrade the outcome — otherwise an x-callback caller would see an error,
			// retry, and duplicate the capture.
			this.choiceExecutor.recordExecutionResult?.({ status: "success", file });

			// Show success notification
			if (this.plugin.settings.showCaptureNotification) {
				this.showSuccessNotice(file, {
					wasNewFile: !fileAlreadyExists,
					action,
				});
			}

			this.insertCaptureLink(file, linkOptions, {
				isCanvasTriggered: !!canvasTarget,
			});

			if (this.choice.openFile && file) {
				const fileOpening = normalizeFileOpening(this.choice.fileOpening);
				const focus = fileOpening.focus ?? true;
				const openExistingTab = openExistingFileTab(this.app, file, focus);

				if (!openExistingTab) {
					await openFile(this.app, file, {
						...fileOpening,
						originLeaf: this.originLeaf,
					});
				}

				const templaterHandledCursor =
					await jumpToNextTemplaterCursorIfPossible(this.app, file);
				if (
					!templaterHandledCursor &&
					canPlaceCursorAtCapture &&
					focus &&
					expectedCursorContent !== null &&
					typeof cursorEndOffset === "number"
				) {
					setMarkdownCursorAtOffset(
						this.app,
						file,
						cursorEndOffset,
						expectedCursorContent,
					);
				}
			}
		} catch (err) {
			if (!contentCommitted) {
				await this.cleanupCreatedClipboardAttachments();
			}
			if (
				handleMacroAbort(err, {
					logPrefix: "Capture execution aborted",
					noticePrefix: "Capture execution aborted",
					defaultReason: "Capture aborted",
				})
			) {
				this.choiceExecutor.signalAbort?.(err);
				return;
			}
			InputPromptDraftStore.getInstance().markExecutionScopeFailed();
			reportError(err, `Error running capture choice "${this.choice.name}"`);
		} finally {
			if (contentCommitted) {
				this.formatter.consumeCreatedClipboardAttachmentPaths();
			}
		}
	}

	private async cleanupCreatedClipboardAttachments(): Promise<void> {
		const paths = this.formatter.consumeCreatedClipboardAttachmentPaths();
		for (const path of paths) {
			try {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					await this.app.vault.delete(file);
				}
			} catch (error) {
				log.logWarning(
					`QuickAdd: failed to clean up clipboard attachment '${path}': ${String(error)}`,
				);
			}
		}
	}

	private async handleCanvasTextCapture(
		target: CanvasTextCaptureTarget,
		action: CaptureAction,
		linkOptions: AppendLinkOptions,
		markContentCommitted: () => void,
	): Promise<void> {
		if (
			action === "currentLine" ||
			action === "newLineAbove" ||
			action === "newLineBelow"
		) {
			throw new ChoiceAbortError(
				"Canvas text cards support top, bottom, insert-after, and insert-before positions only.",
			);
		}

		if (
			(action === "insertAfter" &&
				this.choice.insertAfter?.createIfNotFound &&
				this.choice.insertAfter?.createIfNotFoundLocation === "cursor") ||
			(action === "insertBefore" &&
				this.choice.insertBefore?.createIfNotFound &&
				this.choice.insertBefore?.createIfNotFoundLocation === "cursor")
		) {
			throw new ChoiceAbortError(
				"Canvas text cards do not support creating missing line targets at cursor. Use top or bottom.",
			);
		}

		const file = target.canvasFile;
		this.formatter.setTitle(basenameWithoutMdOrCanvas(file.basename));
		this.formatter.setDestinationFile(file);

		const captureTemplate = this.getCaptureContent();
		const existingText = getCanvasTextCaptureContent(target);

		// "Choose heading when capturing" on a canvas text card: resolve the heading from
		// the card's own text so the insert-after override targets a real line in the card
		// (otherwise heading mode leaves the static `after` empty and the formatter aborts).
		if (this.isInsertAfterHeadingMode()) {
			await this.maybeResolveInsertAfterHeading(existingText);
		}

		const nextText = await this.formatter.formatContentWithFile(
			captureTemplate,
			this.choice,
			existingText,
			file,
		);

		this.captureResolvedOrderedHeading();

		await setCanvasTextCaptureContent(this.app, target, nextText);
		markContentCommitted();

		// Committed; record success before cosmetic steps (see run() for rationale).
		this.choiceExecutor.recordExecutionResult?.({ status: "success", file });

		if (this.plugin.settings.showCaptureNotification) {
			this.showSuccessNotice(file, {
				wasNewFile: false,
				action,
			});
		}

		this.insertCaptureLink(file, linkOptions, {
			isCanvasTriggered: true,
		});

		if (this.choice.openFile && file) {
			const fileOpening = normalizeFileOpening(this.choice.fileOpening);
			const focus = fileOpening.focus ?? true;
			const openExistingTab = openExistingFileTab(this.app, file, focus);

			if (!openExistingTab) {
				await openFile(this.app, file, {
					...fileOpening,
					originLeaf: this.originLeaf,
				});
			}

			await jumpToNextTemplaterCursorIfPossible(this.app, file);
		}
	}

	private async resolveConfiguredCanvasTarget(
		action: CaptureAction,
	): Promise<ConfiguredCanvasCaptureTarget | null> {
		if (this.choice.captureToActiveFile) {
			return null;
		}

		const rawCaptureTo = this.choice.captureTo?.trim() ?? "";
		const nodeId = this.choice.captureToCanvasNodeId?.trim() ?? "";

		if (!rawCaptureTo || !nodeId) {
			return null;
		}

		const targetPath = await this.formatFilePath(rawCaptureTo);
		if (!CANVAS_FILE_EXTENSION_REGEX.test(targetPath)) {
			return null;
		}

		return await resolveConfiguredCanvasCaptureTarget(
			this.app,
			targetPath,
			nodeId,
			action,
		);
	}

	/**
	 * For "Choose heading when capturing": prompt the user with a dropdown of the
	 * destination's headings and set the picked line as the formatter's insert-after
	 * override. The items are byte-exact heading LINES from `content` (so the formatter's
	 * literal search and create-if-not-found round-trip exactly, the #742 invariant),
	 * parsed with the same `getMarkdownHeadings` the inserter uses (so what is offered can
	 * never desync from what is matched). `allowCustomValue` lets the user type a heading on
	 * a new / heading-less target (created via "Create line if not found"). `content` is the
	 * destination's current text — a note body, or a Canvas text card's text. A no-op unless
	 * the choice is in heading mode. Cancelling aborts the capture cleanly (UserCancelError),
	 * before any write.
	 */
	private async maybeResolveInsertAfterHeading(content: string): Promise<void> {
		const insertAfter = this.choice.insertAfter;
		if (!insertAfter?.enabled || !insertAfter.promptHeading) return;

		const lines = getLinesInString(content);
		const headings = getMarkdownHeadings(lines);
		const headingLines = headings.map((h) => lines[h.line]);
		const headingDisplay = headings.map(
			(h) => `${"  ".repeat(Math.max(0, h.level - 1))}${h.text}`,
		);
		const headingTexts = headings.map((h) => h.text);

		let chosen: string;
		try {
			chosen = await InputSuggester.Suggest(
				this.app,
				headingDisplay,
				headingLines,
				{
					allowCustomValue: true,
					placeholder: "Choose a heading to insert under",
					emptyStateText: "No headings found — type a heading to create",
					customValueLabel: (value) => `Insert after new line: ${value}`,
				},
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}

		invariant(
			!!chosen && chosen.length > 0,
			"No heading selected for capture.",
		);

		this.formatter.setInsertAfterTargetOverride(chosen);

		// Notice copy: show the heading TEXT (no '#') for a picked heading; fall back to
		// the raw typed value for a custom entry.
		const pickedIndex = headingLines.indexOf(chosen);
		this.resolvedInsertAfterHeading =
			pickedIndex >= 0 ? headingTexts[pickedIndex] : chosen;
	}

	/**
	 * Whether the choice is in heading-picker mode (After line… + "Choose heading when capturing").
	 */
	private isInsertAfterHeadingMode(): boolean {
		return (
			!!this.choice.insertAfter?.enabled &&
			!!this.choice.insertAfter.promptHeading
		);
	}

	/** Reads the destination note body for the heading picker (empty when the file is new). */
	private async readNoteBodyForHeadingPicker(
		filePath: string,
		fileAlreadyExists: boolean,
	): Promise<string> {
		if (!fileAlreadyExists) return "";
		const file = this.app.vault.getAbstractFileByPath(filePath);
		return file instanceof TFile ? await this.app.vault.read(file) : "";
	}

	private getCaptureContent(): string {
		let content: string;

		if (!this.choice.format.enabled) content = VALUE_SYNTAX;
		else content = this.choice.format.format;

		if (this.choice.task) content = `- [ ] ${content}\n`;

		return content;
	}

	/**
		* Gets a formatted file path to capture content to, either the active file or a specified location.
		* If capturing to a folder, suggests a file within the folder to capture the content to.
		*
		* @param {boolean} shouldCaptureToActiveFile - Determines if the content should be captured to the active file.
		* @returns {Promise<string>} A promise that resolves to the formatted file path where the content should be captured.
		*
		* @throws {Error} Throws an error if there's no active file when trying to capture to active file,
		*                 if the capture path is invalid, or if the target folder is empty.
		*/
	private async getFormattedPathToCaptureTo(
		shouldCaptureToActiveFile: boolean,
	): Promise<string> {
		// One-page preflight: if a specific target file was already chosen, use it
		const preselected = this.choiceExecutor?.variables?.get(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
		) as string | undefined;
		if (
			!shouldCaptureToActiveFile &&
			preselected &&
			typeof preselected === "string" &&
			preselected.length > 0
		) {
			return this.normalizeCaptureFilePath(preselected);
		}

		if (shouldCaptureToActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();
			invariant(activeFile, "Cannot capture to active file - no active file.");

			return activeFile.path;
		}

		const captureTo = this.choice.captureTo;
		const formattedCaptureTo = await this.formatter.formatFileName(
			captureTo,
			this.choice.name,
		);
		const resolution = this.resolveCaptureTarget(formattedCaptureTo);

			switch (resolution.kind) {
				case "vault":
					return this.selectFileInFolder("", true);
				case "tag":
					return this.selectFileWithTag(resolution.tag);
				case "property":
					return this.selectFileWithProperty(
						resolution.field,
						resolution.value,
						resolution.filter,
					);
				case "folder":
					return this.selectFileInFolder(resolution.folder, false);
				case "file":
					return this.normalizeCaptureFilePath(resolution.path);
			}
		}

	private resolveCaptureTarget(
		formattedCaptureTo: string,
	):
		| { kind: "vault" }
		| { kind: "tag"; tag: string }
		| { kind: "property"; field: string; value?: string; filter: FieldFilter }
		| { kind: "folder"; folder: string }
		| { kind: "file"; path: string } {
		// Resolution order:
		// 1) empty => vault picker
		// 2) #tag => tag picker
		// 3) property:<field>[=<value>] => frontmatter-property picker
		// 4) trailing "/" => folder picker (explicit)
		// 5) known file extension => file
		// 6) ambiguous => folder if it exists and no same-name file exists; else file
		const rawCaptureTo = this.stripLeadingSlash(
			formattedCaptureTo.trim(),
		);

		if (rawCaptureTo === "") {
			return { kind: "vault" };
		}

		if (rawCaptureTo.startsWith("#")) {
			return {
				kind: "tag",
				tag: rawCaptureTo.replace(/\.md$/, ""),
			};
		}

		// `property:<field>[=<value>]` pre-filters by a frontmatter field (issue #466).
		// Checked before the `.base`/extension/folder branches so a property value
		// containing `.md`/`/` (or a trailing `/`) can never misroute to a file/folder.
		const propertyTarget = parsePropertyTarget(rawCaptureTo);
		if (propertyTarget) {
			if (!propertyTarget.field) {
				throw new ChoiceAbortError(
					"Property capture target needs a field name, e.g. property:type=draft",
				);
			}
			return {
				kind: "property",
				field: propertyTarget.field,
				value: propertyTarget.value,
				filter: propertyTarget.filter,
			};
		}

		const normalizedCaptureTo = normalizeGeneratedFilePath(
			rawCaptureTo,
			"Capture target file path",
		);

		if (BASE_FILE_EXTENSION_REGEX.test(normalizedCaptureTo)) {
			throw new ChoiceAbortError(
				`Capture to '.base' files is not supported (${normalizedCaptureTo}). Use a Template choice instead.`,
			);
		}

		const endsWithSlash = normalizedCaptureTo.endsWith("/");
		const folderPath = normalizedCaptureTo.replace(/\/+$/, "");

		if (endsWithSlash) {
			return { kind: "folder", folder: folderPath };
		}

		if (
			MARKDOWN_FILE_EXTENSION_REGEX.test(normalizedCaptureTo) ||
			CANVAS_FILE_EXTENSION_REGEX.test(normalizedCaptureTo)
		) {
			return { kind: "file", path: normalizedCaptureTo };
		}

		// Guard against ambiguity where a folder and file share the same name.
		const fileCandidatePath = this.normalizeMarkdownFilePath("", folderPath);
		const fileCandidate = this.app.vault.getAbstractFileByPath(
			fileCandidatePath,
		);
		const fileExists = !!fileCandidate;

		if (isFolder(this.app, folderPath) && !fileExists) {
			return { kind: "folder", folder: folderPath };
		}

		return { kind: "file", path: normalizedCaptureTo };
	}

	/**
	 * Whether a typed picker value already resolves to an existing note, so the
	 * "Create new note" affordance can be suppressed for it. The value is the
	 * displayed name (folder-stripped for folder captures), so the folder prefix is
	 * re-applied and a markdown extension is tried when none is present.
	 */
	private captureTargetExists(folderPathSlash: string, value: string): boolean {
		const withinScope = value.startsWith(folderPathSlash)
			? value
			: `${folderPathSlash}${value}`;
		let normalizedWithinScope: string;
		try {
			normalizedWithinScope = normalizeGeneratedFilePath(
				withinScope,
				"Capture target file path",
			);
		} catch {
			return false;
		}

		const candidates = [normalizedWithinScope];
		if (!/\.(md|canvas)$/i.test(normalizedWithinScope)) {
			candidates.push(
				`${normalizedWithinScope}.md`,
				`${normalizedWithinScope}.canvas`,
			);
		}
		return candidates.some(
			(path) => !!this.app.vault.getAbstractFileByPath(path),
		);
	}

	private async selectFileInFolder(
		folderPath: string,
		captureAnywhereInVault: boolean,
	): Promise<string> {
		const folderPathSlash =
			folderPath.endsWith("/") || captureAnywhereInVault
				? folderPath
				: `${folderPath}/`;
		const filesInFolder = getMarkdownFilesInFolder(this.app, folderPathSlash);

		invariant(filesInFolder.length > 0, `Folder ${folderPathSlash} is empty.`);

		// Quick-Switcher-style ordering: recent first, excluded sunk, alphabetical tail.
		const filePaths = orderFilesForPicker(
			filesInFolder,
			buildPickerOrderingDeps(this.app),
		).map((f) => f.path);
		const allowCreate = this.choice.createFileIfItDoesntExist?.enabled ?? false;
		let targetFilePath: string;
		try {
			targetFilePath = await InputSuggester.Suggest(
				this.app,
				filePaths.map((item) => item.replace(folderPathSlash, "")),
				filePaths,
				{
					allowCustomValue: allowCreate,
					customValueLabel: (value) => `Create new note: ${value}`,
					valueExists: (value) =>
						this.captureTargetExists(folderPathSlash, value),
				},
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}

		invariant(
			!!targetFilePath && targetFilePath.length > 0,
			"No file selected for capture.",
		);

		// Ensure user has selected a file in target folder. InputSuggester allows user to write
		// their own file path, so we need to make sure it's in the target folder.
		const filePath = targetFilePath.startsWith(`${folderPathSlash}`)
			? targetFilePath
			: `${folderPathSlash}${targetFilePath}`;

		return await this.formatFilePath(filePath);
	}

	private async selectFileWithTag(tag: string): Promise<string> {
		const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
		const filesWithTag = getMarkdownFilesWithTag(this.app, tagWithHash);

		return this.selectFileFromSet(filesWithTag, `No files with tag ${tag}.`);
	}

	private async selectFileWithProperty(
		field: string,
		value: string | undefined,
		filter: FieldFilter,
	): Promise<string> {
		const filesWithProperty = getMarkdownFilesWithProperty(
			this.app,
			field,
			value,
			filter,
		);

		const propertyLabel = value !== undefined ? `${field}=${value}` : field;
		return this.selectFileFromSet(
			filesWithProperty,
			`No notes with property ${propertyLabel}.`,
		);
	}

	/**
	 * Whether a typed picker value already resolves to an existing note — by exact
	 * path (root or a typed sub-path, with/without a .md/.canvas extension) OR by a
	 * bare basename matching a note in ANY folder. `vaultBasenames` is the set of
	 * existing note basenames (lowercased), built once per picker so this is O(1)
	 * per keystroke. Suppresses the "Create new note" affordance for any name that
	 * already exists, so a vault-wide picker never mislabels an existing note as
	 * creatable, captures into it, or spawns a duplicate-basename note.
	 */
	private captureTargetAlreadyExists(
		value: string,
		vaultBasenames: Set<string>,
	): boolean {
		const raw = value.trim();
		if (!raw) return false;
		let normalized: string;
		try {
			normalized = normalizeGeneratedFilePath(
				raw,
				"Capture target file path",
			);
		} catch {
			return false;
		}

		const base = normalized.replace(/\.(md|canvas)$/i, "");
		const pathCandidates = [normalized, `${base}.md`, `${base}.canvas`];
		if (
			pathCandidates.some(
				(path) => !!this.app.vault.getAbstractFileByPath(path),
			)
		) {
			return true;
		}
		const basename = base.slice(base.lastIndexOf("/") + 1);
		return vaultBasenames.has(basename.toLowerCase());
	}

	/**
	 * Shared picker for the "anywhere in the vault" capture scopes (tag, property):
	 * the matched notes can live in any folder, so the picker shows full paths. The
	 * "Create new note" affordance is suppressed for any name that already exists
	 * in the vault (by path or basename, in any folder), so typing an existing —
	 * possibly non-matching — note never mislabels as "create", never silently
	 * captures into that file, and never spawns a duplicate-basename note.
	 */
	private async selectFileFromSet(
		files: TFile[],
		notFoundMessage: string,
	): Promise<string> {
		invariant(files.length > 0, notFoundMessage);

		// Quick-Switcher-style ordering; show note names (not raw paths).
		const filePaths = orderFilesForPicker(
			files,
			buildPickerOrderingDeps(this.app),
		).map((f) => f.path);
		const allowCreate = this.choice.createFileIfItDoesntExist?.enabled ?? false;
		// Build once (not per keystroke): existing note basenames across the vault.
		const vaultBasenames = new Set(
			this.app.vault
				.getMarkdownFiles()
				.map((f) => f.basename.toLowerCase()),
		);
		let targetFilePath: string;
		try {
			targetFilePath = await InputSuggester.Suggest(
				this.app,
				filePaths,
				filePaths,
				{
					renderItem: (path, el) => renderNotePathSuggestion(el, path),
					allowCustomValue: allowCreate,
					customValueLabel: (value) => `Create new note: ${value}`,
					valueExists: (value) =>
						this.captureTargetAlreadyExists(value, vaultBasenames),
				},
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}

		invariant(
			!!targetFilePath && targetFilePath.length > 0,
			"No file selected for capture.",
		);

		return await this.formatFilePath(targetFilePath);
	}

	private async onFileExists(
		filePath: string,
		content: string,
	): Promise<CaptureWriteResult> {
		const file: TFile = this.getFileByPath(filePath);
		if (!file) throw new Error("File not found");

		// Set the title to the existing file's basename
		this.formatter.setTitle(file.basename);

		// Set the destination file so formatters can generate proper relative links
		this.formatter.setDestinationFile(file);

		// First format pass...
		const formatted = await this.collectIfFrontmatter(
			() => this.formatter.formatContentOnly(content),
		);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());

		const fileContent: string = await this.app.vault.read(file);
		// Second format pass, with the file content... User input (long running) should have been captured during first pass
		// So this pass is to insert the formatted capture value into the file content, depending on the user's settings
		const formattedFileContent: string =
			await this.collectIfFrontmatter(() =>
				this.formatter.formatContentWithFile(
					formatted,
					this.choice,
					fileContent,
					file,
				),
			);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());
		const cursorEndOffset = this.formatter.getCaptureInsertionEndOffset();

		const secondReadFileContent: string = await this.app.vault.read(file);

		let newFileContent = formattedFileContent;
		let cursorPlacementSafe = true;
		if (secondReadFileContent !== fileContent) {
			const res = merge(
				secondReadFileContent,
				fileContent,
				formattedFileContent,
			);
			invariant(
				res.isSuccess(),
				() =>
					`The file ${filePath} has been modified since the last read.\nQuickAdd could not merge the versions two without conflicts, and will not modify the file.\nThis is in order to prevent data loss.`,
			);

			newFileContent = res.joinedResults() as string;
			cursorPlacementSafe = false;
		}

		return {
			file,
			newFileContent,
			captureContent: formatted,
			cursorEndOffset: cursorEndOffset ?? undefined,
			cursorPlacementSafe,
		};
	}

	private async onCreateFileIfItDoesntExist(
		filePath: string,
		captureContent: string,
		linkOptions?: AppendLinkOptions,
	): Promise<CaptureWriteResult> {
		// Extract filename without extension from the full path.
		const fileBasename = basenameWithoutMdOrCanvas(filePath);
		this.formatter.setTitle(fileBasename);

		// Set the destination path so formatters can generate proper relative links
		// even before the file is created
		this.formatter.setDestinationSourcePath(filePath);

		// First formatting pass: resolve QuickAdd placeholders and prompt for user input (e.g. {{value}})
		// This mirrors the logic used when the target file already exists and prevents the timing issue
		// where templater would run before the {{value}} placeholder is substituted (Issue #809).
		const formattedCaptureContent: string =
			await this.collectIfFrontmatter(() =>
				this.formatter.formatContentOnly(captureContent),
			);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());

		let fileContent = "";
		if (this.choice.createFileIfItDoesntExist.createWithTemplate) {
			const singleTemplateEngine: SingleTemplateEngine =
				new SingleTemplateEngine(
					this.app,
					this.plugin,
					this.choice.createFileIfItDoesntExist.template,
					this.choiceExecutor,
				);

			if (linkOptions?.enabled && !linkOptions.requireActiveFile) {
				singleTemplateEngine.setLinkToCurrentFileBehavior("optional");
			}

			// The SingleTemplateEngine has its own formatter; give it the
			// destination folder so {{FOLDER}} resolves in the template body.
			singleTemplateEngine.setTargetFolderPath(parentFolderPath(filePath));

			fileContent = await singleTemplateEngine.run();

			// Get template variables from the template engine's formatter
			const templateVars = singleTemplateEngine.getAndClearTemplatePropertyVars();

			log.logMessage(`CaptureChoiceEngine: Collected ${templateVars.size} template property variables`);
			if (templateVars.size > 0) {
				log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(', ')}`);
			}

			// Store for later use
			this.templatePropertyVars = templateVars;
		}

		// Create the new file with the (optional) template content
		const file: TFile = await this.createFileWithInput(filePath, fileContent, {
			suppressTemplaterOnCreate:
				this.choice.createFileIfItDoesntExist.createWithTemplate,
		});

		// Post-process front matter for template property types if we used a template
		if (this.choice.createFileIfItDoesntExist.createWithTemplate &&
			this.templatePropertyVars &&
			shouldPostProcessFrontMatter(file, this.templatePropertyVars)) {
			await postProcessFrontMatter(this.app, file, this.templatePropertyVars);
		}

		// Process Templater commands in the template if a template was used
		if (
			this.choice.createFileIfItDoesntExist.createWithTemplate &&
			fileContent
		) {
			await overwriteTemplaterOnce(this.app, file);
		} else if (isTemplaterTriggerOnCreateEnabled(this.app)) {
			await waitForTemplaterTriggerOnCreateToComplete(this.app, file);
		}

		// Read the file fresh from disk to avoid any potential cached content
		// after the initial Templater run on newly created files.
		const updatedFileContent: string = await this.app.vault.read(file);
		// Second formatting pass: embed the already-resolved capture content into the newly created file
		const newFileContent: string =
			await this.collectIfFrontmatter(() =>
				this.formatter.formatContentWithFile(
					formattedCaptureContent,
					this.choice,
					updatedFileContent,
					file,
				),
			);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());
		const cursorEndOffset = this.formatter.getCaptureInsertionEndOffset();

		return {
			file,
			newFileContent,
			captureContent: formattedCaptureContent,
			cursorEndOffset: cursorEndOffset ?? undefined,
			cursorPlacementSafe: true,
		};
	}

	private async formatFilePath(captureTo: string) {
		const formattedCaptureTo: string = await this.formatter.formatFileName(
			captureTo,
			this.choice.name,
		);

		return this.normalizeCaptureFilePath(formattedCaptureTo);
	}

	private normalizeCaptureFilePath(path: string): string {
		const normalizedPath = normalizeGeneratedFilePath(
			this.stripLeadingSlash(path),
			"Capture target file path",
		);
		if (BASE_FILE_EXTENSION_REGEX.test(normalizedPath)) {
			throw new ChoiceAbortError(
				`Capture to '.base' files is not supported (${normalizedPath}). Use a Template choice instead.`,
			);
		}
		const finalPath = this.normalizeCaptureFilePathExtension(normalizedPath);

		// A formatted target like 'notes/.md' has no usable file name (e.g. an
		// optional token left empty). Fail clearly instead of creating it.
		const basename = basenameWithoutMdOrCanvas(finalPath);
		if (!basename.trim()) {
			throw new ChoiceAbortError(
				`Capture target file name is empty after formatting ('${finalPath}'). Make sure the tokens in 'Capture to' produce a value.`,
			);
		}

		return finalPath;
	}

	private normalizeCaptureFilePathExtension(path: string): string {
		const markdownExtension = path.match(MARKDOWN_FILE_EXTENSION_REGEX)?.[0];
		if (markdownExtension) {
			return `${normalizeGeneratedFilePath(
				path.replace(MARKDOWN_FILE_EXTENSION_REGEX, ""),
				"Capture target file path",
			)}${markdownExtension}`;
		}

		const canvasExtension = path.match(CANVAS_FILE_EXTENSION_REGEX)?.[0];
		if (canvasExtension) {
			return `${normalizeGeneratedFilePath(
				path.replace(CANVAS_FILE_EXTENSION_REGEX, ""),
				"Capture target file path",
			)}${canvasExtension}`;
		}

		return this.normalizeMarkdownFilePath("", path);
	}

	/**
	 * Runs a formatting pass, collecting structured front matter values for a
	 * later processFrontMatter pass — unless collection is suppressed (editor
	 * insertion actions), in which case the value is substituted inline as text
	 * so nothing is left stranded as a placeholder.
	 */
	private collectIfFrontmatter<T>(work: () => Promise<T>): Promise<T> {
		if (this.suppressFrontmatterCollection) {
			return work();
		}
		return this.formatter.withTemplatePropertyCollection(work);
	}

	private mergeCapturePropertyVars(vars: Map<string, unknown>): void {
		if (!vars || vars.size === 0) {
			return;
		}

		for (const [key, value] of vars) {
			this.capturePropertyVars.set(key, value);
		}

		log.logMessage(
			`CaptureChoiceEngine: Accumulated ${this.capturePropertyVars.size} structured capture variables`
		);
	}

	private async applyCapturePropertyVars(file: TFile): Promise<boolean> {
		if (this.capturePropertyVars.size === 0) {
			return false;
		}

		if (!shouldPostProcessFrontMatter(file, this.capturePropertyVars)) {
			this.capturePropertyVars.clear();
			return false;
		}

		log.logMessage(
			`CaptureChoiceEngine: Post-processing front matter with ${this.capturePropertyVars.size} capture variables`
		);
		await postProcessFrontMatter(this.app, file, this.capturePropertyVars);
		this.capturePropertyVars.clear();
		return true;
	}
}
