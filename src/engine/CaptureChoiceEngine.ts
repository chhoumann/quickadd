import { prepareCapture, type CaptureCursor } from "../formatters/helpers/capturePlacement";
import { insertCaptureInEditor, setMarkdownCursorsAtOffsets } from "../utils/editorInsertion";
import { mapEditorCursorPlacement, type EditorCursorPlacement, type EditorTextMutationObserver } from "../utils/editorCursorPlacement";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import { getAppendLinkDestinationFile } from "../utils/fileLinks";
import { appendLinkDestinationError, insertChoiceFileLink, copyChoiceFileLink, openChoiceFile } from "./choiceFileActions";
import {
	Notice,
	TFile,
	type App,
	type WorkspaceLeaf,
} from "obsidian";
import { getActiveMarkdownEditorView } from "src/utils/activeMarkdownEditor";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import invariant from "src/utils/invariant";
import { readNote, writeNote } from "../utils/noteContent";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	CANVAS_FILE_EXTENSION_REGEX,
	CREATE_IF_NOT_FOUND_ORDERED,
	MARKDOWN_FILE_EXTENSION_REGEX,
	VALUE_SYNTAX,
} from "../constants";
import { CaptureChoiceFormatter } from "../formatters/captureChoiceFormatter";
import { getMarkdownHeadings } from "../formatters/helpers/getEndOfSection";
import { getLinesInString } from "../utility";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { parsePropertyCapture, type PropertyCapture } from "../types/choices/ICaptureChoice";
import {
	capturesListItems,
	formatContainsPropertyToken,
	isEmptyCaptureListValue,
	planPropertyUpdate,
	readCaptureFrontmatter,
	resolveCapturePropertyKey,
	restorePropertyCaptureSeeds,
	seedPropertyCaptureVariables,
	serializeCaptureFrontmatter,
	snapshotPropertyCaptureSeeds,
	validatePropertyName,
} from "./captureProperty";
import { resolveObsidianPropertyType } from "../utils/obsidianPropertyTypes";
import { TemplatePropertyCollector } from "../utils/TemplatePropertyCollector";
import { coerceYamlValue } from "../utils/yamlValues";
import { inheritPropertyValueType } from "../utils/propertyCaptureFormat";
import {
	normalizeAppendLinkOptions,
	placementSupportsFrontmatter,
	type AppendLinkOptions,
} from "../types/linkPlacement";
import {
	appendToCurrentLine,
	insertOnNewLineAbove,
	insertOnNewLineBelow,
	isTemplaterTriggerOnCreateEnabled,
	jumpToNextTemplaterCursorIfPossible,
	overwriteTemplaterOnce,
	setMarkdownCursorAtOffset,
	templaterParseTemplate,
	waitForTemplaterTriggerOnCreateToComplete,
} from "../utilityObsidian";
import { reportError } from "../utils/errorUtils";
import {
	ChoiceOutcomeRecorder,
	failureReason,
} from "./choiceOutcomeRecorder";
import type { ChoiceEffect } from "../types/ChoiceOutcome";
import { routePrompt } from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { basenameWithoutMdOrCanvas, parentFolderPath } from "../utils/pathUtils";
import { CaptureTargetEngine } from "./CaptureTargetEngine";
import {
	postProcessFrontMatter,
	shouldPostProcessFrontMatter,
	assignFrontmatterValue,
} from "./helpers/frontmatterPostProcessor";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { assertCreatableFilePath } from "./assertCreatableFilePath";
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

const MULTI_SELECT_TOKEN_REGEX =
	/\{\{(?:VALUE|FILE|FIELD):[^}]*\|\s*multi\s*(?=[:}|]|$)[^}]*\}\}/gi;
const EXPLICIT_MULTI_FORMAT_REGEX =
	/\|\s*format\s*:\s*(?:inline|spaced|yaml|markdown)\s*(?=\||}})/i;

function hasContextualMultiSelectToken(input: string): boolean {
	return Array.from(input.matchAll(MULTI_SELECT_TOKEN_REGEX)).some(
		(match) => !EXPLICIT_MULTI_FORMAT_REGEX.test(match[0]),
	);
}

type NormalizedAppendLinkOptions = ReturnType<typeof normalizeAppendLinkOptions>;

type CaptureWriteResult = {
	file: TFile;
	newFileContent: string;
	captureContent: string;
	/**
	 * The note's text that `newFileContent` was computed from, so `run()` can report
	 * whether the capture actually changed anything rather than inferring it from the
	 * payload (#1615). An empty payload can still create a note, and a non-empty one can
	 * still leave the file untouched, so the payload is the wrong thing to ask.
	 */
	priorContent: string;
	cursor: CaptureCursor;
	markerOnly?: boolean;
};

export class CaptureChoiceEngine extends CaptureTargetEngine {
	choice: ICaptureChoice;
	protected formatter: CaptureChoiceFormatter;
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
	private readonly outcome: ChoiceOutcomeRecorder;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ICaptureChoice,
		protected choiceExecutor: IChoiceExecutor,
		private readonly originLeaf: WorkspaceLeaf | null = null,
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.outcome = new ChoiceOutcomeRecorder(choiceExecutor);
		this.formatter = new CaptureChoiceFormatter(app, plugin, choiceExecutor);
		// Every prompt this run opens can say which choice is asking (issue #1546).
		this.formatter.setPromptRunContext({
			draftScopeId: choice.id,
			choiceName: choice.name,
		});
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
		{ isCanvasTriggered, onEditorTextMutation }: { isCanvasTriggered: boolean; onEditorTextMutation?: EditorTextMutationObserver },
	): Promise<void> {
		if (!linkOptions.enabled) {
			return;
		}

		if (
			linkOptions.destination?.type !== "specifiedFile" &&
			!placementSupportsFrontmatter(linkOptions.placement) &&
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

		await insertChoiceFileLink(this.app, file, linkOptions, this.choiceExecutor.focusedProperty, onEditorTextMutation);
	}

	private async copyCapturedFileLinkToClipboard(file: TFile): Promise<void> {
		if (!this.choice.copyLinkToClipboard) {
			return;
		}

		await copyChoiceFileLink(file);
	}

	private validateAppendLinkDestination(
		linkOptions: NormalizedAppendLinkOptions,
	): boolean {
		const error = appendLinkDestinationError(this.app, linkOptions);
		if (!error) return true;
		this.failRun(error);
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

			const propertyCapture = this.choice.propertyCapture === undefined
				? undefined
				: parsePropertyCapture(this.choice.propertyCapture);
			const action = propertyCapture ? "append" : getCaptureAction(this.choice);
			const activeCanvasTarget = this.choice.captureToActiveFile
				? resolveActiveCanvasCaptureTarget(this.app, action)
				: null;
			const configuredCanvasTarget =
				await this.resolveConfiguredCanvasTarget(action);
			const canvasTarget = activeCanvasTarget ?? configuredCanvasTarget;

			if (canvasTarget?.kind === "text") {
				if (propertyCapture) {
					throw new ChoiceAbortError("Property capture requires a Markdown note. Canvas text cards do not have note properties.");
				}
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
				!propertyCapture && canvasTarget?.kind === "file" &&
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

			const fileAlreadyExists = await this.fileExists(filePath);

			// Refuse an impossible target here rather than at vault.create (#1591).
			// Gated character-for-character on the dispatch condition below, so a
			// missing target with creation OFF still gets its own message - and an
			// EXISTING file with a colon in its name (legal on macOS/Linux, so a note
			// made outside Obsidian can have one) keeps appending as it does today.
			// Placed above the heading picker rather than inside
			// onCreateFileIfItDoesntExist so the user is not asked to choose a
			// heading for a note that cannot be created.
			if (!fileAlreadyExists && this.choice?.createFileIfItDoesntExist?.enabled) {
				assertCreatableFilePath(filePath);
			}
			if (propertyCapture) {
				await this.captureToProperty({
					filePath, fileAlreadyExists, config: propertyCapture, linkOptions,
					isCanvasTriggered: !!canvasTarget,
					onCommit: () => { contentCommitted = true; },
				});
				return;
			}

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
				hasContextualMultiSelectToken(this.choice?.format?.format ?? "")
			) {
				log.logWarning(
					"QuickAdd: {{VALUE:…|multi}}, {{FILE:…|multi}} and {{FIELD:…|multi}} in this capture write comma-separated strings by default. Add |format:yaml, |format:markdown, |format:inline or |format:spaced to choose the output explicitly.",
				);
			}

			if (!fileAlreadyExists && !this.choice?.createFileIfItDoesntExist?.enabled) {
				throw new ChoiceAbortError(
					`Target file missing: ${filePath}. Enable "Create file if it doesn't exist" or choose an existing file.`,
				);
			}

			const write = fileAlreadyExists
				? await this.onFileExists(filePath, content, action === "currentLine" || action === "newLineAbove" || action === "newLineBelow")
				: await this.onCreateFileIfItDoesntExist(filePath, content, linkOptions);
			if (write === null) {
				if (this.plugin.settings.showCaptureNotification) {
					new Notice("Nothing to capture (no content)", DEFAULT_NOTICE_DURATION);
				}
				this.outcome.success(undefined, "unchanged");
				return;
			}
			if (write.markerOnly) {
				contentCommitted = !fileAlreadyExists;
				if (this.plugin.settings.showCaptureNotification) {
					this.showNothingToCaptureNotice(write.file, { wasNewFile: !fileAlreadyExists });
				}
				this.outcome.success(write.file, fileAlreadyExists ? "unchanged" : "created");
				return;
			}
			this.captureResolvedOrderedHeading();
			const committed = await this.commitCapture(write, {
				action, fileAlreadyExists,
				onCommit: () => { contentCommitted = true; },
			});
			if (!committed) return;
			const { file } = write;
			const { captureIsNoOp, marked } = committed;
			let cursor = committed.cursor;
			// Commit success before links/navigation so later failures cannot invite duplicate writes.
			this.outcome.success(file, committed.effect);

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

			if (cursor && linkOptions.enabled) {
				const rewriteTarget = linkOptions.destination.type === "specifiedFile"
					? getAppendLinkDestinationFile(this.app, linkOptions.destination)
					: placementSupportsFrontmatter(linkOptions.placement)
						? this.app.workspace.getActiveFile()
						: this.choiceExecutor.focusedProperty?.file;
				if (rewriteTarget?.path === file.path) cursor = null;
			}
			await this.insertCaptureLink(file, linkOptions, {
				isCanvasTriggered: !!canvasTarget,
				onEditorTextMutation: marked && cursor && !placementSupportsFrontmatter(linkOptions.placement) ? mutation => {
					if (marked && cursor && mutation.filePath === file.path) cursor = mapEditorCursorPlacement(cursor, mutation);
				} : undefined,
			});

			let focus = normalizeFileOpening(this.choice.fileOpening).focus ?? true;
			if (this.choice.openFile) {
				focus = await openChoiceFile({
					app: this.app, file, opening: this.choice.fileOpening, originLeaf: this.originLeaf,
				});
			}
			const activeDestination = getActiveMarkdownEditorView(this.app)?.file?.path === file.path;
			if (this.choice.openFile || (marked && activeDestination)) {
				const templaterHandled = await jumpToNextTemplaterCursorIfPossible(this.app, file);
				if (!templaterHandled && cursor && (focus || (marked && activeDestination))) {
					if (cursor.offsets.length === 1) setMarkdownCursorAtOffset(this.app, file, cursor.offsets[0], cursor.content);
					else setMarkdownCursorsAtOffsets(this.app, file, cursor.offsets, cursor.content);
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
			// Record BEFORE reporting: the notice is for whoever is at the desktop, the
			// reason is for whoever is not (a CLI or interactive-bridge caller), and both
			// must say the same thing (#1603). A no-op once the capture committed, so a
			// post-commit link/open failure cannot make an automation retry and write
			// the capture twice.
			this.outcome.failure(failureReason(err));
			reportError(err, `Error running capture choice "${this.choice.name}"`);
		} finally {
			if (contentCommitted) {
				this.formatter.consumeCreatedClipboardAttachmentPaths();
			}
		}
	}

	private async commitCapture(write: CaptureWriteResult, options: {
		action: CaptureAction;
		fileAlreadyExists: boolean;
		onCommit: () => void;
	}): Promise<{
		effect: ChoiceEffect;
		captureIsNoOp: boolean;
		cursor: EditorCursorPlacement | null;
		marked: boolean;
	} | null> {
		const { file, captureContent, newFileContent, priorContent, cursor: placement } = write;
		let captureIsNoOp = isCaptureContentEmpty(captureContent);
		const { action } = options;
		if (action === "currentLine" || action === "newLineAbove" || action === "newLineBelow") {
			const parsed = captureIsNoOp ? captureContent : await templaterParseTemplate(this.app, captureContent, file);
			const payload = prepareCapture(parsed);
			if (payload.cursor.kind === "none" && /{{CURSOR}}/i.test(parsed)) {
				if (this.plugin.settings.showCaptureNotification) {
					this.showNothingToCaptureNotice(file, { wasNewFile: !options.fileAlreadyExists });
				}
				this.outcome.success(file, "unchanged");
				return null;
			}
			captureIsNoOp = isCaptureContentEmpty(payload.content);
			const marked = payload.cursor.kind === "offset" && payload.cursor.source === "marker";
			let cursor: EditorCursorPlacement | null = null;
			if (!captureIsNoOp) {
				const insert = action === "currentLine" ? appendToCurrentLine
					: action === "newLineAbove" ? insertOnNewLineAbove : insertOnNewLineBelow;
				const inserted = marked ? (cursor = insertCaptureInEditor(payload, this.app, file, action)) !== null
					: insert(payload.content, this.app);
				if (!inserted) {
					await this.cleanupCreatedClipboardAttachments();
					this.failRun(`Capture "${this.choice.name}": no active Markdown editor to insert into.`);
					return null;
				}
			}
			options.onCommit();
			return { effect: captureIsNoOp ? "unchanged" : "changed", captureIsNoOp, cursor, marked };
		}

		const { content: written, merged } = await writeNote(this.app, file, priorContent, newFileContent);
		options.onCommit();
		const wholeFileTemplater = this.choice.templater?.afterCapture === "wholeFile";
		if (wholeFileTemplater) await overwriteTemplaterOnce(this.app, file);
		const postProcessed = await this.applyCapturePropertyVars(file);
		// Only a pass that actually rewrote the note invalidates the cursor offsets.
		const rewritten = (wholeFileTemplater || postProcessed) && await this.app.vault.read(file) !== written;
		const effect: ChoiceEffect = !options.fileAlreadyExists ? "created"
			: newFileContent !== priorContent || rewritten ? "changed" : "unchanged";
		const cursor = !merged && !rewritten && placement.kind === "offset"
			? { offsets: [placement.value], content: newFileContent } : null;
		return { effect, captureIsNoOp, cursor, marked: placement.kind === "offset" && placement.source === "marker" };
	}

	private async captureToProperty(args: {
		filePath: string;
		fileAlreadyExists: boolean;
		config: PropertyCapture;
		linkOptions: NormalizedAppendLinkOptions;
		isCanvasTriggered: boolean;
		onCommit: () => void;
	}): Promise<void> {
		const { filePath, fileAlreadyExists, config, linkOptions } = args;
		if (!MARKDOWN_FILE_EXTENSION_REGEX.test(filePath)) {
			throw new ChoiceAbortError("Property capture requires a Markdown note.");
		}
		if (!fileAlreadyExists && !this.choice.createFileIfItDoesntExist.enabled) {
			throw new ChoiceAbortError(`Target file missing: ${filePath}. Enable "Create file if it doesn't exist" or choose an existing file.`);
		}
		let file = fileAlreadyExists ? this.getFileByPath(filePath) : undefined;
		this.formatter.setTitle(basenameWithoutMdOrCanvas(filePath));
		this.formatter.setTargetFolderPath(parentFolderPath(filePath));
		this.formatter.setDestinationSourcePath(filePath);
		if (file) this.formatter.setDestinationFile(file);
		this.formatter.setPromptRunContext({
			draftScopeId: this.choice.id, choiceName: this.choice.name,
			destination: filePath, destinationKind: "file",
		});

		let initialContent = file ? await readNote(this.app, file) : "";
		const createWithTemplate = !file && this.choice.createFileIfItDoesntExist.createWithTemplate;
		let templateVars = new Map<string, unknown>();
		if (createWithTemplate) {
			const template = new SingleTemplateEngine(this.app, this.plugin,
				this.choice.createFileIfItDoesntExist.template, this.choiceExecutor);
			template.setDestinationPath(filePath);
			template.setPromptRunContext({
				draftScopeId: `${this.choice.id}#${this.choice.createFileIfItDoesntExist.template}`,
				choiceName: this.choice.name, destination: filePath, destinationKind: "file",
			});
			if (linkOptions.enabled && !linkOptions.requireActiveFile) template.setLinkToCurrentFileBehavior("optional");
			initialContent = await template.run();
			templateVars = template.getAndClearTemplatePropertyVars();
		}
		const frontmatter = readCaptureFrontmatter(initialContent);
		for (const [key, value] of templateVars) {
			assignFrontmatterValue(frontmatter, key.split(TemplatePropertyCollector.PATH_SEPARATOR), coerceYamlValue(value));
		}
		const key = resolveCapturePropertyKey(frontmatter, validatePropertyName(config.property.kind === "named"
			? await this.formatter.formatPropertyName(config.property.format)
			: await this.promptForCaptureProperty(frontmatter, config.createIfMissing)));
		const registeredType = resolveObsidianPropertyType(this.app, key, { registeredOnly: true });
		const existingValue = Object.prototype.hasOwnProperty.call(frontmatter, key) ? frontmatter[key] : undefined;
		const inputType = registeredType ?? (typeof existingValue === "number" ? "number" : typeof existingValue === "boolean" ? "checkbox" : null);
		const propertyFormat = this.choice.format.enabled ? this.choice.format.format : VALUE_SYNTAX;
		const seedSnapshot = snapshotPropertyCaptureSeeds(this.choiceExecutor.variables);
		try {
			seedPropertyCaptureVariables(this.choiceExecutor.variables, key, existingValue);
			// Consume any stale flag from an earlier format pass on this formatter.
			this.formatter.consumePropertyTokenExpanded();
			const value = await this.formatter.formatPropertyValue(inheritPropertyValueType(
				propertyFormat, inputType,
			), {
				listItems: capturesListItems({ key, action: config.action, registeredType, existing: existingValue }),
			});
			// Raw-format detection covers the common case. The expansion flag covers
			// {{PROPERTY}} injected by macros, templates, or global variables.
			const compose = formatContainsPropertyToken(propertyFormat)
				|| this.formatter.consumePropertyTokenExpanded();
			const plan = (current: Record<string, unknown>) => planPropertyUpdate({
				frontmatter: current, key, value, config,
				registeredType: resolveObsidianPropertyType(this.app, key, { registeredOnly: true }),
				compose,
			});
			const prepared = plan(frontmatter);
			if (config.action === "addToList" && isEmptyCaptureListValue(value)) {
				this.outcome.success(file, "unchanged");
				return;
			}

			let priorContent = "";
			if (file) {
				priorContent = await readNote(this.app, file);
				await this.app.fileManager.processFrontMatter(file, (current: Record<string, unknown>) => {
					current[resolveCapturePropertyKey(current, key)] = plan(current);
				});
			} else {
				frontmatter[key] = prepared;
				file = await this.createFileWithInput(filePath, serializeCaptureFrontmatter(initialContent, frontmatter), {
					suppressTemplaterOnCreate: createWithTemplate,
				});
			}
			args.onCommit();
			if (!fileAlreadyExists && (createWithTemplate || isTemplaterTriggerOnCreateEnabled(this.app))) {
				if (createWithTemplate) await overwriteTemplaterOnce(this.app, file);
				else await waitForTemplaterTriggerOnCreateToComplete(this.app, file);
				await this.app.fileManager.processFrontMatter(file, (current: Record<string, unknown>) => {
					current[resolveCapturePropertyKey(current, key)] = plan(current);
				});
			}
			const persistedContent = await this.app.vault.read(file);
			this.outcome.success(file, !fileAlreadyExists ? "created" : persistedContent === priorContent ? "unchanged" : "changed");
			if (this.plugin.settings.showCaptureNotification) {
				new Notice(`Captured to '${key}' in '${file.basename}'`, DEFAULT_NOTICE_DURATION);
			}
			await this.copyCapturedFileLinkToClipboard(file);
			await this.insertCaptureLink(file, linkOptions, { isCanvasTriggered: args.isCanvasTriggered });
			if (this.choice.openFile) {
				await openChoiceFile({
					app: this.app, file, opening: this.choice.fileOpening, originLeaf: this.originLeaf,
				});
			}
		} finally {
			restorePropertyCaptureSeeds(this.choiceExecutor.variables, seedSnapshot);
		}
	}

	private async promptForCaptureProperty(frontmatter: Record<string, unknown>, allowCreate: boolean): Promise<string> {
		const keys = Object.keys(frontmatter).filter((key) => key !== "__proto__").sort((a, b) => a.localeCompare(b));
		if (!allowCreate && keys.length === 0) {
			throw new ChoiceAbortError("The capture target has no properties. Enable 'Create property if missing' to add one.");
		}
		return await routePrompt(this.choiceExecutor, {
			remote: (provider) => promptEngineChoice(provider, {
				items: keys.map((key) => ({ value: key, title: key })),
				placeholder: "Property", allowCustomInput: allowCreate, what: "the property picker",
			}),
			headless: async () => {
				throw new ChoiceAbortError("Property capture needs a property selection. Configure a named property or run with the ui flag.");
			},
			app: () => InputSuggester.Suggest(this.app, keys, keys, {
				placeholder: "Property", allowCustomValue: allowCreate,
				customValueLabel: (key) => `Create property: ${key}`,
				valueExists: (key) => keys.some((existing) => existing.trim().toLowerCase() === key.trim().toLowerCase()),
			}),
		});
	}

	/**
	 * A failure exit that is not a throw: log it for the desktop, and record the same
	 * message as the run's outcome so a caller who cannot see notices learns the cause
	 * instead of the CLI's fixed "Choice execution failed" sentence (#1603).
	 */
	private failRun(message: string): void {
		InputPromptDraftStore.getInstance().markExecutionScopeFailed();
		log.logError(message);
		this.outcome.failure(message);
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

		const { content: nextText, markerOnly } = await this.formatter.formatContentWithFile(
			captureTemplate,
			this.choice,
			existingText,
			file,
		);

		if (markerOnly) {
			if (this.plugin.settings.showCaptureNotification) {
				this.showNothingToCaptureNotice(file, { wasNewFile: false });
			}
			this.outcome.success(file, "unchanged");
			return;
		}
		this.captureResolvedOrderedHeading();

		// An empty/whitespace capture leaves the card text unchanged (the formatter
		// returns existingText as-is) — surface a no-op notice instead of a false
		// "Captured to …" success, consistent with the note-body path in run().
		const captureIsNoOp = nextText === existingText;

		// Checked BEFORE the write, not after. `setCanvasTextCaptureContent` re-serialises
		// the whole .canvas JSON, so writing identical card text can still rewrite the
		// file's bytes — which would make the "unchanged" this run is about to report
		// false, and would touch a file the user was told was left alone (#1615).
		if (!captureIsNoOp) {
			await setCanvasTextCaptureContent(this.app, target, nextText);
		}
		markContentCommitted();

		// Committed; append-link/open-file steps remain post-commit (see run()).
		this.outcome.success(file, captureIsNoOp ? "unchanged" : "changed");

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
			await openChoiceFile({
				app: this.app, file,
				opening: this.choice.fileOpening, originLeaf: this.originLeaf,
			});
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

	private async maybeResolveInsertAfterHeading(content: string): Promise<void> {
		const insertAfter = this.choice.insertAfter;
		if (!insertAfter?.enabled || !insertAfter.promptHeading) return;

		const allowCreate = !!insertAfter.createIfNotFound;

		const lines = getLinesInString(content);
		const headings = getMarkdownHeadings(lines);
		const headingLines = headings.map((h) => lines[h.line]);
		const headingDisplay = headings.map(
			(h) => `${"  ".repeat(Math.max(0, h.level - 1))}${h.text}`,
		);
		const headingTexts = headings.map((h) => h.text);

		const placeholder = "Choose a heading to insert under";
		const chosen = String(
			await routePrompt(this.choiceExecutor, {
				// Routed like every other prompt the run opens. Before, an interactive
				// run opened this on the desktop while the client's /poll returned
				// nothing (#1614).
				remote: (provider) =>
					promptEngineChoice(provider, {
						items: headingLines.map((line, index) => ({
							value: line,
							title: headingDisplay[index] ?? line,
						})),
						placeholder,
						allowCustomInput: allowCreate,
						what: "the heading picker",
					}),
				// Non-interactive run (CLI without `ui`): no one can answer, so opening
				// it would hang. Abort with an actionable error.
				headless: () => {
					throw new ChoiceAbortError(
						`'${this.choice.name}' needs to ask which heading to capture under, but this run is non-interactive. ` +
							`Turn off "Choose heading when capturing" and set a fixed heading, or re-run with the ui flag.`,
					);
				},
				app: () =>
					InputSuggester.Suggest(this.app, headingDisplay, headingLines, {
						allowCustomValue: allowCreate,
						placeholder,
						emptyStateText: allowCreate
							? "No headings found — type a heading to create"
							: "No headings found in the target note",
						customValueLabel: (value) => `Insert after new line: ${value}`,
					}),
			}),
		);

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
		return file instanceof TFile ? await readNote(this.app, file) : "";
	}

	private getCaptureContent(): string {
		let content: string;

		if (!this.choice.format.enabled) content = VALUE_SYNTAX;
		else content = this.choice.format.format;

		if (this.choice.task) content = `- [ ] ${content}\n`;

		return content;
	}

	private async onFileExists(
		filePath: string,
		content: string,
		editorInsertion = false,
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

		const fileContent = await readNote(this.app, file);
		if (/{{CURSOR}}/i.test(formatted) && prepareCapture(formatted).cursor.kind === "none") {
			return { file, newFileContent: fileContent, captureContent: "", priorContent: fileContent, cursor: { kind: "none" }, markerOnly: true };
		}
		if (editorInsertion) {
			return { file, newFileContent: fileContent, captureContent: formatted, priorContent: fileContent, cursor: { kind: "none" } };
		}
		// Second format pass, with the file content... User input (long running) should have been captured during first pass
		// So this pass is to insert the formatted capture value into the file content, depending on the user's settings
		const placement =
			await this.collectIfFrontmatter(() =>
				this.formatter.formatContentWithFile(
					formatted,
					this.choice,
					fileContent,
					file,
				),
			);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());


		if (placement.markerOnly) {
			return { file, newFileContent: fileContent, captureContent: placement.captureContent, priorContent: fileContent, cursor: placement.cursor, markerOnly: true };
		}

		// writeNote merges any edits made to the note while the capture was being formatted.
		return {
			file,
			newFileContent: placement.content,
			captureContent: placement.captureContent,
			priorContent: fileContent,
			cursor: placement.cursor,
		};
	}

	private async onCreateFileIfItDoesntExist(
		filePath: string,
		captureContent: string,
		linkOptions?: AppendLinkOptions,
	): Promise<CaptureWriteResult | null> {
		// Re-asserted at the sink, so the invariant is local to the one function
		// that creates the file, not only to its caller's branch. It is an
		// `includes` scan over a short string and costs nothing (#1591).
		assertCreatableFilePath(filePath);

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
		if (/{{CURSOR}}/i.test(formattedCaptureContent) && prepareCapture(formattedCaptureContent).cursor.kind === "none") {
			return null;
		}


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
			// destination folder so {{FOLDER}} resolves in the template body, and
			// the run context so its prompts still name the choice and target.
			singleTemplateEngine.setTargetFolderPath(parentFolderPath(filePath));
			singleTemplateEngine.setPromptRunContext({
				// Scoped to the template: the engine has its own formatter and raises
				// its own {{VALUE}} prompt, which must not share the capture body
				// prompt's draft key.
				draftScopeId: `${this.choice.id}#${this.choice.createFileIfItDoesntExist.template}`,
				choiceName: this.choice.name,
				destination: filePath,
				destinationKind: "file",
			});

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
		const placement =
			await this.collectIfFrontmatter(() =>
				this.formatter.formatContentWithFile(
					formattedCaptureContent,
					this.choice,
					updatedFileContent,
					file,
				),
			);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());


		return {
			file,
			newFileContent: placement.content,
			captureContent: placement.captureContent,
			priorContent: updatedFileContent,
			cursor: placement.cursor,
			markerOnly: placement.markerOnly,
		};
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
