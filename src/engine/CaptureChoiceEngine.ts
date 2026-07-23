import {
	Notice,
	TFile,
	type App,
	type WorkspaceLeaf,
} from "obsidian";
import { getActiveMarkdownEditorView } from "src/utils/activeMarkdownEditor";
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
import {
	normalizeAppendLinkOptions,
	placementSupportsFrontmatter,
	type AppendLinkOptions,
} from "../types/linkPlacement";
import {
	appendToCurrentLine,
	getMarkdownFilesInFolder,
	getMarkdownFilesMatchingFilter,
	getMarkdownFilesWithProperty,
	getMarkdownFilesWithTag,
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
import type { FieldFilter } from "../utils/FieldSuggestionParser";
import {
	resolveCaptureTarget as resolveCaptureTargetFromString,
	type CaptureTargetResolution,
} from "./helpers/captureTargetResolution";
import {
	classifyCaptureTargetScope,
	markdownFilePathForFolderCandidate,
	type CaptureTargetScope,
} from "./helpers/captureTargetScope";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import {
	appendFileLinkToDestinationFile,
	copyFileLinkToClipboard,
	getAppendLinkDestinationFile,
} from "../utils/fileLinks";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { appendLinkToFrontmatterProperty } from "../utils/frontmatterPropertyLinks";
import { basenameWithoutMdOrCanvas, parentFolderPath } from "../utils/pathUtils";
import { buildFileDisplayLabels } from "../utils/fileSyntax";
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

// Mirrors CaptureChoiceFormatter's "nothing to capture" definition: only ASCII
// whitespace counts as empty (Unicode spaces like U+00A0 are intentional content,
// see #760). Kept local so the engine's no-op detection does not depend on the
// formatter module's mocked shape in tests.
const ASCII_WHITESPACE_ONLY_REGEX = /^[ \t\r\n\f\v]*$/;
function isCaptureContentEmpty(content: string): boolean {
	return ASCII_WHITESPACE_ONLY_REGEX.test(content);
}

type NormalizedAppendLinkOptions = ReturnType<typeof normalizeAppendLinkOptions>;

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

	/**
	 * Shown instead of the success notice when the formatted capture payload is
	 * empty/whitespace-only: the file is unchanged (the formatter returns it as-is,
	 * and editor insertion replaces the selection with an empty string), so a
	 * confident "Captured to …" would be misleading. `wasNewFile` keeps the "note
	 * created" fact honest when create-if-not-found still made an empty file.
	 */
	private showNothingToCaptureNotice(
		file: TFile,
		{ wasNewFile }: { wasNewFile: boolean },
	) {
		const fileName = `'${file.basename}'`;
		new Notice(
			wasNewFile
				? `Created ${fileName} — nothing to capture (no content)`
				: `Nothing to capture — ${fileName} unchanged`,
			DEFAULT_NOTICE_DURATION,
		);
	}

	private hasActiveMarkdownCaptureContext(): boolean {
		const hasActiveFile = !!this.app.workspace.getActiveFile();
		const hasActiveMarkdownView = !!getActiveMarkdownEditorView(this.app);
		return hasActiveFile && hasActiveMarkdownView;
	}

	private shouldSkipRequiredCanvasLinkInsertion(
		linkOptions: AppendLinkOptions,
		isCanvasTriggered: boolean,
	): boolean {
		return (
			isCanvasTriggered &&
			linkOptions.destination?.type !== "specifiedFile" &&
			linkOptions.requireActiveFile &&
			!this.hasActiveMarkdownCaptureContext()
		);
	}

	private async insertCaptureLink(
		file: TFile,
		linkOptions: AppendLinkOptions,
		{ isCanvasTriggered }: { isCanvasTriggered: boolean },
	): Promise<void> {
		if (!linkOptions.enabled) {
			return;
		}

		if (linkOptions.destination?.type === "specifiedFile") {
			await appendFileLinkToDestinationFile(this.app, file, linkOptions);
			return;
		}

		if (placementSupportsFrontmatter(linkOptions.placement)) {
			await insertFileLinkToActiveView(this.app, file, linkOptions);
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

		const propertyTarget = this.choiceExecutor.focusedProperty;
		if (propertyTarget) {
			await appendLinkToFrontmatterProperty(this.app, propertyTarget, file);
			return;
		}

		await insertFileLinkToActiveView(this.app, file, linkOptions);
	}

	private async copyCapturedFileLinkToClipboard(file: TFile): Promise<void> {
		if (!this.choice.copyLinkToClipboard) {
			return;
		}

		try {
			await copyFileLinkToClipboard(file);
		} catch (error) {
			log.logWarning(
				`Could not copy link to clipboard for '${file.path}': ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private validateAppendLinkDestination(
		linkOptions: NormalizedAppendLinkOptions,
	): boolean {
		if (
			!linkOptions.enabled ||
			linkOptions.destination.type !== "specifiedFile"
		) {
			return true;
		}

		if (getAppendLinkDestinationFile(this.app, linkOptions.destination)) {
			return true;
		}

		InputPromptDraftStore.getInstance().markExecutionScopeFailed();
		log.logError(
			`Append link target file not found or is not a Markdown file: ${linkOptions.destination.path}`,
		);
		return false;
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
			if (!this.validateAppendLinkDestination(linkOptions)) return;
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
				// `|multi1`, `|multi-select`, etc. FIELD is included because
				// {{FIELD:…|multi}} degrades to a comma-joined string in the exact
				// same way VALUE/FILE do (see formatter.ts replaceFieldVarInString).
				/\{\{(?:VALUE|FILE|FIELD):[^}]*\|\s*multi(?=[:}|]|$)/i.test(
					this.choice?.format?.format ?? "",
				)
			) {
				log.logWarning(
					"QuickAdd: {{VALUE:…|multi}}, {{FILE:…|multi}} and {{FIELD:…|multi}} in this capture write comma-separated strings, not YAML lists. Multi-select produces a real list only when capturing into a brand-new note's front matter (Create file if it doesn't exist, without a template).",
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
			// The formatted capture payload is empty/whitespace-only: the formatter
			// returns the file unchanged and editor insertion replaces the selection
			// with "" — i.e. a no-op. Surface a distinct notice instead of a false
			// "Captured to …" success (e.g. a {{VALUE}} prompt cancelled to empty).
			const captureIsNoOp = isCaptureContentEmpty(captureContent);

			this.captureResolvedOrderedHeading();

			// Handle capture to active file with special actions
			if (isEditorInsertionAction) {
				if (captureIsNoOp) {
					// Empty/whitespace payload: do NOT touch the editor. Inserting
					// would add a blank line (newLineAbove/Below) or replace — i.e.
					// DELETE — the active selection (currentLine), modifying the note
					// while the run reports "nothing to capture". Skip the insertion
					// so the no-op notice below is truthful and harmless.
					contentCommitted = true;
				} else {
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
				}
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

			// Content is committed. Record success before append-link/open-file steps
			// so a later post-commit failure cannot make automation callers retry and
			// duplicate the Capture side effect.
			this.choiceExecutor.recordExecutionResult?.({ status: "success", file });

			// Show success notification
			if (this.plugin.settings.showCaptureNotification) {
				if (captureIsNoOp) {
					this.showNothingToCaptureNotice(file, {
						wasNewFile: !fileAlreadyExists,
					});
				} else {
					this.showSuccessNotice(file, {
						wasNewFile: !fileAlreadyExists,
						action,
					});
				}
			}

			await this.copyCapturedFileLinkToClipboard(file);

			await this.insertCaptureLink(file, linkOptions, {
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
					await this.app.fileManager.trashFile(file);
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

		// An empty/whitespace capture leaves the card text unchanged (the formatter
		// returns existingText as-is) — surface a no-op notice instead of a false
		// "Captured to …" success, consistent with the note-body path in run().
		const captureIsNoOp = nextText === existingText;

		// Committed; append-link/open-file steps remain post-commit (see run()).
		this.choiceExecutor.recordExecutionResult?.({ status: "success", file });

		if (this.plugin.settings.showCaptureNotification) {
			if (captureIsNoOp) {
				this.showNothingToCaptureNotice(file, { wasNewFile: false });
			} else {
				this.showSuccessNotice(file, {
					wasNewFile: false,
					action,
				});
			}
		}

		await this.copyCapturedFileLinkToClipboard(file);

		await this.insertCaptureLink(file, linkOptions, {
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
	 * never desync from what is matched). `allowCustomValue` lets the user type a NEW heading
	 * only when "Create line if not found" is enabled — otherwise the override path can only
	 * match an existing line and would abort after the user already typed one (the picker must
	 * never offer to create a heading the engine cannot create). `content` is the
	 * destination's current text — a note body, or a Canvas text card's text. A no-op unless
	 * the choice is in heading mode. Cancelling aborts the capture cleanly (UserCancelError),
	 * before any write.
	 */
	/**
	 * Abort a runtime capture-target file picker on a non-interactive run (CLI
	 * without `ui`) instead of hanging on an unanswerable suggester. Reached when a
	 * format-syntax "Capture to" resolves to a folder/tag/property scope the
	 * requirement collector could not pre-collect.
	 */
	private assertInteractiveCaptureTarget(): void {
		if (this.choiceExecutor.interactive === false) {
			throw new ChoiceAbortError(
				`'${this.choice.name}' needs to ask which note to capture into, but this run is non-interactive. ` +
					`Point "Capture to" at a specific file, or re-run with the ui flag.`,
			);
		}
	}

	private async maybeResolveInsertAfterHeading(content: string): Promise<void> {
		const insertAfter = this.choice.insertAfter;
		if (!insertAfter?.enabled || !insertAfter.promptHeading) return;

		// Non-interactive run (CLI without `ui`): the heading picker has no one to
		// answer it, so opening it would hang. Abort with an actionable error.
		if (this.choiceExecutor.interactive === false) {
			throw new ChoiceAbortError(
				`'${this.choice.name}' needs to ask which heading to capture under, but this run is non-interactive. ` +
					`Turn off "Choose heading when capturing" and set a fixed heading, or re-run with the ui flag.`,
			);
		}

		const allowCreate = !!insertAfter.createIfNotFound;

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
					allowCustomValue: allowCreate,
					placeholder: "Choose a heading to insert under",
					emptyStateText: allowCreate
						? "No headings found — type a heading to create"
						: "No headings found in the target note",
					customValueLabel: (value) =>
						`Insert after new line: ${value}`,
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
		if (shouldCaptureToActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();
			invariant(activeFile, "Cannot capture to active file - no active file.");

			return activeFile.path;
		}

		// A preselected capture target (the trusted one-page preflight pick, or a
		// non-interactive CLI `value-__qa.captureTargetFilePath`) is honoured ONLY
		// when the configured "Capture to" actually needs a runtime file pick — the
		// same scopes the requirement collector emits the pick for — AND the value is
		// confined to that scope. For a definite-file target the configured path is
		// authoritative, so a reserved variable injected across a trust boundary (an
		// obsidian:// URI, the CLI, or a {{VALUE:__qa.…}} token in a synced/imported
		// choice) cannot redirect the capture to an arbitrary note.
		const preselected = this.getPreselectedCaptureTargetPath();
		if (preselected !== undefined) {
			const scope = classifyCaptureTargetScope(
				{
					isFolder: (path) => isFolder(this.app, path),
					markdownFileExists: (path) =>
						this.app.vault.getAbstractFileByPath(
							markdownFilePathForFolderCandidate(path),
						) instanceof TFile,
				},
				this.choice.captureTo ?? "",
				false,
			);
			if (scope) {
				const confined = this.confinePreselectedToScope(scope, preselected);
				if (confined !== null) {
					return this.normalizeCaptureFilePath(confined);
				}
				// Out-of-scope value: ignore it and fall back to the normal
				// picker/resolution below (which aborts a non-interactive run).
			}
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
			case "filter":
				return this.selectFileWithFilter(resolution.filter);
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

	/**
	 * The capture-target file path supplied out-of-band for this run, read from the
	 * reserved internal variable: set by trusted preflight plumbing (the one-page
	 * input modal) or by a non-interactive CLI `value-__qa.captureTargetFilePath`.
	 * Returns `undefined` when absent or blank. The caller honours it only for a
	 * runtime-picker scope and confines it to that scope, so a reserved key injected
	 * across a trust boundary cannot hijack a definite-file capture target.
	 */
	private getPreselectedCaptureTargetPath(): string | undefined {
		const preselected = this.choiceExecutor?.variables?.get(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
		);
		return typeof preselected === "string" && preselected.length > 0
			? preselected
			: undefined;
	}

	/**
	 * Confines a preselected capture target to the SAME destination set the matching
	 * interactive picker would accept, so the value can never escape the configured
	 * "Capture to" scope:
	 *  - folder: re-prefixed into the folder, mirroring {@link selectFileInFolder}
	 *    (an empty folderPathSlash is the whole-vault scope, so no confinement).
	 *  - filter/property/tag: a note the scope already matches is always allowed.
	 *    With creation OFF nothing else is (the picker only offers matched notes);
	 *    with creation ON a NEW name is allowed too, but an EXISTING note the scope
	 *    does not match is rejected - the picker suppresses it (InputSuggester
	 *    getSuggestions, valueExists), and honouring it would let an injected value
	 *    append to an arbitrary existing note.
	 * Returns `null` when the value is outside the scope; the caller then falls back
	 * to the normal picker/resolution instead of honouring it.
	 */
	private confinePreselectedToScope(
		scope: CaptureTargetScope,
		preselected: string,
	): string | null {
		const stripped = this.stripLeadingSlash(preselected);

		if (scope.kind === "folder") {
			return scope.folderPathSlash &&
				!stripped.startsWith(scope.folderPathSlash)
				? `${scope.folderPathSlash}${stripped}`
				: stripped;
		}

		const matched = this.resolveScopeFiles(scope);
		if (matched.some((file) => file.path === stripped)) {
			return stripped;
		}

		const allowCreate =
			this.choice.createFileIfItDoesntExist?.enabled ?? false;
		if (!allowCreate) {
			return null;
		}

		// Creation is on: the picker offers a NEW name but suppresses any existing
		// note (by normalized path OR basename anywhere - selectFileFromSet +
		// captureTargetAlreadyExists). Mirror it exactly so an injected value cannot
		// append to an arbitrary existing note or spawn a duplicate-basename note.
		// captureTargetAlreadyExists normalizes the value the same way the eventual
		// write does (trailing space/dot stripped), so a `Note.md ` variant of an
		// existing note is still caught.
		const vaultBasenames = new Set(
			this.app.vault.getMarkdownFiles().map((f) => f.basename.toLowerCase()),
		);
		return this.captureTargetAlreadyExists(stripped, vaultBasenames)
			? null
			: stripped;
	}

	/** The notes a tag/filter/property capture scope currently matches. */
	private resolveScopeFiles(scope: CaptureTargetScope): TFile[] {
		switch (scope.kind) {
			case "filter":
				return getMarkdownFilesMatchingFilter(this.app, scope.filter);
			case "property":
				return getMarkdownFilesWithProperty(
					this.app,
					scope.field,
					scope.value,
					scope.filter,
				);
			case "tag":
				return getMarkdownFilesWithTag(this.app, scope.tag);
			case "folder":
				return getMarkdownFilesInFolder(this.app, scope.folderPathSlash);
		}
	}

	/**
	 * Adapter: classifies the formatted "Capture to" string into a concrete
	 * destination via the pure {@link resolveCaptureTargetFromString}, binding the
	 * live vault probes. Kept as a method so the existing call site and tests stay
	 * unchanged.
	 */
	private resolveCaptureTarget(
		formattedCaptureTo: string,
	): CaptureTargetResolution {
		return resolveCaptureTargetFromString(formattedCaptureTo, {
			getAbstractFileByPath: (path) =>
				this.app.vault.getAbstractFileByPath(path),
			isFolder: (path) => isFolder(this.app, path),
			normalizeMarkdownFilePath: (folderPath, fileName) =>
				this.normalizeMarkdownFilePath(folderPath, fileName),
		});
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
		const allowCreate = this.choice.createFileIfItDoesntExist?.enabled ?? false;

		invariant(
			allowCreate || filesInFolder.length > 0,
			`Folder ${folderPathSlash} is empty.`,
		);

		// Non-interactive run (CLI without `ui`): a format-syntax "Capture to" target
		// resolves to a folder/vault scope at runtime (the requirement collector
		// cannot pre-collect it), so this picker would hang. Abort with a clear error.
		// Placed after the empty-folder check so a genuinely empty scope surfaces its
		// own accurate error rather than the prompt message.
		this.assertInteractiveCaptureTarget();

		// Quick-Switcher-style ordering: recent first, excluded sunk, alphabetical tail.
		const orderedFiles = orderFilesForPicker(
			filesInFolder,
			buildPickerOrderingDeps(this.app),
		);
		const filePaths = orderedFiles.map((f) => f.path);
		const displayItems = buildFileDisplayLabels(
			orderedFiles,
			(file) => this.app.metadataCache.getFileCache(file),
		);
		const searchItems = filePaths.map(
			(path, index) => `${displayItems[index] ?? path} ${path}`,
		);
		const existingLabels = new Set(
			displayItems.map((label) => label.toLowerCase()),
		);
		let targetFilePath: string;
		try {
			targetFilePath = await InputSuggester.Suggest(
				this.app,
				displayItems,
				filePaths,
				{
					placeholder: allowCreate
						? "Choose a note or type to create one"
						: undefined,
					emptyStateText: allowCreate
						? "Type a note name to create it"
						: undefined,
					renderItem: (path, el) =>
						renderNotePathSuggestion(el, path, this.app),
					searchItems,
					allowCustomValue: allowCreate,
					customValueLabel: (value) => `Create new note: ${value}`,
					valueExists: (value) =>
						existingLabels.has(value.toLowerCase()) ||
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

	private async selectFileWithFilter(filter: FieldFilter): Promise<string> {
		const files = getMarkdownFilesMatchingFilter(this.app, filter);
		return this.selectFileFromSet(
			files,
			"No files matched the capture target filters.",
		);
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
		const allowCreate = this.choice.createFileIfItDoesntExist?.enabled ?? false;

		invariant(allowCreate || files.length > 0, notFoundMessage);

		// See selectFileInFolder: a format-syntax tag/property capture target resolves
		// to a runtime file picker the requirement collector can't pre-collect. Placed
		// after the no-match check so an empty result surfaces its own accurate error.
		this.assertInteractiveCaptureTarget();

		// Quick-Switcher-style ordering; show note names (not raw paths).
		const orderedFiles = orderFilesForPicker(
			files,
			buildPickerOrderingDeps(this.app),
		);
		const filePaths = orderedFiles.map((f) => f.path);
		const displayItems = buildFileDisplayLabels(
			orderedFiles,
			(file) => this.app.metadataCache.getFileCache(file),
		);
		const searchItems = filePaths.map(
			(path, index) => `${displayItems[index] ?? path} ${path}`,
		);
		// Build once (not per keystroke): existing note basenames across the vault.
		const vaultBasenames = new Set(
			this.app.vault
				.getMarkdownFiles()
				.map((f) => f.basename.toLowerCase()),
		);
		const existingLabels = new Set(
			displayItems.map((label) => label.toLowerCase()),
		);
		let targetFilePath: string;
		try {
			targetFilePath = await InputSuggester.Suggest(
				this.app,
				displayItems,
				filePaths,
				{
					placeholder: allowCreate
						? "Choose a note or type to create one"
						: undefined,
					emptyStateText: allowCreate
						? "Type a note name to create it"
						: undefined,
					renderItem: (path, el) =>
						renderNotePathSuggestion(el, path, this.app),
					searchItems,
					allowCustomValue: allowCreate,
					customValueLabel: (value) => `Create new note: ${value}`,
					valueExists: (value) =>
						existingLabels.has(value.toLowerCase()) ||
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

		// Contain the assembled target at assembly — BEFORE the run() existence probe
		// (`fileExists(filePath)`) that precedes the create sink. normalizeGeneratedFilePath
		// intentionally leaves absolute/drive/UNC paths for the boundary check, so without
		// this a 'Capture to' formatting to e.g. "C:/secret.md" would reach adapter.exists
		// out-of-vault on Windows before createFileWithInput could reject it. Mirrors the
		// Template path's normalizeTemplateFilePath guard.
		if (escapesVaultBoundary(finalPath)) {
			throw new ChoiceAbortError(
				`Refusing to capture to a file outside the vault: "${finalPath}".`,
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
