import { prepareCapture, type CaptureCursor } from "../utils/capturePlacement";
import { restoreUserText, restoreUserTextInCapture } from "../formatters/helpers/userText";
import { insertCaptureInEditor, setMarkdownCursorsAtOffsets, appendToCurrentLine, insertOnNewLineAbove, insertOnNewLineBelow, setMarkdownCursorAtOffset } from "../utils/editorInsertion";
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
import { processNote, readNote, writeNote } from "../utils/noteContent";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	CANVAS_FILE_EXTENSION_REGEX,
	CREATE_IF_NOT_FOUND_ORDERED,
	MARKDOWN_FILE_EXTENSION_REGEX,
	VALUE_SYNTAX,
} from "../constants";
import { CaptureChoiceFormatter } from "../formatters/captureChoiceFormatter";
import { extractHeadingsFromLines } from "../utils/sectionLink";
import { log } from "../logger/logManager";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
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
import { warnDeprecatedOnce } from "../utils/templaterRerunDeprecation";
import {
	normalizeAppendLinkOptions,
	placementSupportsFrontmatter,
	type AppendLinkOptions,
} from "../types/linkPlacement";
import { createNoteAfterTemplaterTrigger, isTemplaterTriggerOnCreateEnabled, jumpToNextTemplaterCursorIfPossible, overwriteTemplaterOnce, templaterParseTemplate } from "../utils/templaterIntegration";
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
import { getCaptureAction, isEditorAction, usesSelectionAsCaptureValue, withoutCursorPosition, type CaptureAction } from "../utils/captureAction";
import { createFileWithInput, getFileByPath } from "./vaultFiles";
import { hasCursorMarker, isCaptureContentEmpty, isCursorMarkerOnly } from "../utils/capturePlacement";
import { currentEditorView, currentFile, namesCurrentNote } from "../utils/currentFile";
import {
	getCanvasTextCaptureContent,
	resolveActiveCanvasCaptureTarget,
	resolveConfiguredCanvasCaptureTarget,
	setCanvasTextCaptureContent,
	type CanvasTextCaptureTarget,
	type ConfiguredCanvasCaptureTarget,
} from "./canvasCapture";
import { handleMacroAbort } from "../utils/macroAbortHandler";
import type { ChoiceChain } from "./choiceChain";
import {
	getPeriodicNoteSettings,
	type Period,
	type PeriodicNoteSettings,
	readPeriodicNoteTemplate,
	renderPeriodicNoteTemplate,
} from "../utils/periodicNotes";

const DEFAULT_NOTICE_DURATION = 4000;

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
	 * The text `newFileContent` was computed from. Whether the capture changed the
	 * note is decided from this: an empty payload can still create a note, and a
	 * non-empty one can leave it untouched.
	 */
	priorContent: string;
	cursor: CaptureCursor;
	markerOnly?: boolean;
};

export class CaptureChoiceEngine extends CaptureTargetEngine {
	choice: ICaptureChoice;
	protected formatter: CaptureChoiceFormatter;
	private readonly plugin: ChoiceRuntimePlugin;
	private templatePropertyVars?: Map<string, unknown>;
	private capturePropertyVars: Map<string, unknown> = new Map();
	// True when the capture lands in a note body rather than becoming the file's
	// own front matter. Collection is then suppressed so containers are not
	// stranded as "[]" placeholders.
	private suppressFrontmatterCollection = false;
	// Heading text (without `#`) picked by "Choose heading when capturing", for the notice.
	private resolvedInsertAfterHeading: string | null = null;
	private readonly outcome: ChoiceOutcomeRecorder;

	constructor(
		app: App,
		plugin: ChoiceRuntimePlugin,
		private readonly runtime: FormatterExecutionRuntime,
		choice: ICaptureChoice,
		protected choiceExecutor: IChoiceExecutor,
		private readonly originLeaf: WorkspaceLeaf | null = null,
		private readonly chain: ChoiceChain = [choice],
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.outcome = new ChoiceOutcomeRecorder(choiceExecutor);
		this.formatter = new CaptureChoiceFormatter(app, plugin, choiceExecutor, runtime);
		this.formatter.choiceChain = chain;
		this.formatter.setPromptRunContext({
			draftScopeId: choice.id,
			choiceName: choice.name,
		});
	}

	/**
	 * Lets the success notice of an ordered capture name the resolved heading
	 * instead of the raw `{{DATE:…}}` token.
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
			case "top":
				msg = `Captured to top of ${fileName}`;
				break;
			case "bottom":
				msg = `Captured to bottom of ${fileName}`;
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
	 * Replaces the success notice when the payload is blank and the file is
	 * unchanged. `wasNewFile` keeps the "note created" fact when
	 * create-if-not-found still made an empty file.
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
		return !!currentFile(this.app, this.choiceExecutor) && !!getActiveMarkdownEditorView(this.app);
	}

	/** A note named with `current=` is Markdown but no active editor shows it: a cursor write cannot land, a vault write can. */
	private namedNoteHasNoEditor(): boolean {
		return namesCurrentNote(this.choiceExecutor)
			&& currentFile(this.app, this.choiceExecutor)?.extension === "md"
			&& !currentEditorView(this.app, this.choiceExecutor);
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

		await insertChoiceFileLink(this.app, file, linkOptions, this.choiceExecutor, onEditorTextMutation);
	}

	private async copyCapturedFileLinkToClipboard(file: TFile): Promise<void> {
		if (!this.choice.copyLinkToClipboard) {
			return;
		}

		await copyChoiceFileLink(file);
	}

	private configureFormatter(linkOptions: NormalizedAppendLinkOptions): void {
		this.formatter.setLinkToCurrentFileBehavior(
			linkOptions.enabled && !linkOptions.requireActiveFile
				? "optional"
				: "required",
		);
		this.formatter.setUseSelectionAsCaptureValue(usesSelectionAsCaptureValue(this.choice, this.plugin.settings));
	}

	/**
	 * Where this run writes: a Canvas text card, or a note path (a Canvas file
	 * card's note, the active note, or the formatted Capture to path). Aborts on a
	 * target the capture cannot write to.
	 */
	private async resolveWriteTarget(
		action: CaptureAction,
		isPropertyCapture: boolean,
	): Promise<
		| { kind: "canvasText"; canvas: CanvasTextCaptureTarget }
		| { kind: "note"; filePath: string; isCanvasTriggered: boolean }
	> {
		// A Canvas is JSON, so a capture into it lands on a selected card or not at
		// all: with Capture to active file and a Canvas as the current note, that
		// Canvas must be the active view. A configured target exists only without it.
		const current = currentFile(this.app, this.choiceExecutor);
		const currentCanvas = this.choice.captureToActiveFile && current?.extension === "canvas" ? current : null;
		const canvasTarget = currentCanvas
			? resolveActiveCanvasCaptureTarget(this.app, action, currentCanvas)
			: await this.resolveConfiguredCanvasTarget(action);
		if (currentCanvas && !canvasTarget) {
			throw new ChoiceAbortError(
				`Cannot capture to Canvas '${currentCanvas.path}' - it is not the active view. Open it and select one card.`,
			);
		}

		if (canvasTarget?.kind === "text") {
			if (isPropertyCapture) {
				throw new ChoiceAbortError("Property capture requires a Markdown note. Canvas text cards do not have note properties.");
			}
			return { kind: "canvasText", canvas: canvasTarget };
		}

		if (
			!isPropertyCapture &&
			canvasTarget?.kind === "file" &&
			this.createsMissingLineTargetAtCursor(action)
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

		return { kind: "note", filePath, isCanvasTriggered: !!canvasTarget };
	}

	private createsMissingLineTargetAtCursor(action: CaptureAction): boolean {
		const target =
			action === "insertAfter" ? this.choice.insertAfter
				: action === "insertBefore" ? this.choice.insertBefore
					: undefined;
		return !!target?.createIfNotFound && target.createIfNotFoundLocation === "cursor";
	}

	/**
	 * Readies a capture into a note before anything is formatted or written: asks
	 * for the heading in heading-picker mode, decides whether the capture's front
	 * matter is collected, and aborts on a missing note that is not to be created.
	 */
	private async prepareNoteWrite(filePath: string, fileAlreadyExists: boolean): Promise<void> {
		// Canvas text cards pick their heading in handleCanvasTextCapture.
		if (
			this.isInsertAfterHeadingMode() &&
			!CANVAS_FILE_EXTENSION_REGEX.test(filePath)
		) {
			await this.maybeResolveInsertAfterHeading(
				await this.readNoteBodyForHeadingPicker(filePath, fileAlreadyExists),
			);
		}

		// Collect property types only when the capture becomes a new file's own
		// front matter. In a body, collection would strand a "[]" placeholder and
		// write the values to the wrong note.
		const captureBecomesOwnFrontmatter =
			!fileAlreadyExists &&
			!!this.choice?.createFileIfItDoesntExist?.enabled &&
			!this.choice?.createFileIfItDoesntExist?.createWithTemplate &&
			// A periodic note created from its template has that template's front matter.
			!this.periodicNoteFor(filePath)?.settings.template;
		this.suppressFrontmatterCollection = !captureBecomesOwnFrontmatter;

		// |multi only yields a YAML list in the new note's own front matter;
		// elsewhere it degrades to a comma-joined string, so warn.
		if (
			this.suppressFrontmatterCollection &&
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
	}

	async run(): Promise<void> {
		let contentCommitted = false;
		try {
			this.capturePropertyVars.clear();
			const linkOptions = normalizeAppendLinkOptions(this.choice.appendLink);
			this.configureFormatter(linkOptions);
			const linkDestinationError = appendLinkDestinationError(this.app, linkOptions);
			if (linkDestinationError) {
				this.outcome.fail(linkDestinationError);
				return;
			}

			const propertyCapture = this.choice.propertyCapture === undefined
				? undefined
				: parsePropertyCapture(this.choice.propertyCapture);
			if (!propertyCapture && isEditorAction(getCaptureAction(this.choice)) && this.namedNoteHasNoEditor()) {
				this.choice = withoutCursorPosition(this.choice);
			}
			const action = propertyCapture ? "bottom" : getCaptureAction(this.choice);
			const target = await this.resolveWriteTarget(action, !!propertyCapture);
			if (target.kind === "canvasText") {
				await this.handleCanvasTextCapture(
					target.canvas,
					action,
					linkOptions,
					() => {
						contentCommitted = true;
					},
				);
				return;
			}
			const { filePath, isCanvasTriggered } = target;

			const content = this.getCaptureContent();

			const fileAlreadyExists = await this.app.vault.adapter.exists(filePath);

			// Refuse an impossible name before the heading picker asks about a note
			// that cannot be created. An existing file with a colon (legal outside
			// Obsidian on macOS/Linux) keeps working.
			if (!fileAlreadyExists && this.choice?.createFileIfItDoesntExist?.enabled) {
				assertCreatableFilePath(filePath);
			}
			if (propertyCapture) {
				await this.captureToProperty({
					filePath, fileAlreadyExists, config: propertyCapture, linkOptions,
					isCanvasTriggered,
					onCommit: () => { contentCommitted = true; },
				});
				return;
			}

			await this.prepareNoteWrite(filePath, fileAlreadyExists);

			const write = fileAlreadyExists
				? await this.onFileExists(filePath, content, isEditorAction(action))
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
			await this.finishCapture(write.file, {
				...committed, action, wasNewFile: !fileAlreadyExists, linkOptions, isCanvasTriggered,
			});
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
			// Record before reporting so the notice and the caller's reason agree. A
			// no-op once the capture committed, so a post-commit failure cannot make
			// an automation retry and write the capture twice.
			this.outcome.failure(failureReason(err));
			reportError(err, `Error running capture choice "${this.choice.name}"`);
		} finally {
			if (contentCommitted) {
				this.formatter.consumeCreatedClipboardAttachmentPaths();
			}
		}
	}

	/**
	 * Everything after the capture is written, for a note and a Canvas text card:
	 * record the outcome, tell the user, copy and insert the link, open the file
	 * and place the cursor. `cursor` is where a `{{CURSOR}}` marker (`marked`) or
	 * the insertion left it, or null.
	 */
	private async finishCapture(file: TFile, result: {
		effect: ChoiceEffect;
		captureIsNoOp: boolean;
		cursor: EditorCursorPlacement | null;
		marked: boolean;
		action: CaptureAction;
		wasNewFile: boolean;
		linkOptions: NormalizedAppendLinkOptions;
		isCanvasTriggered: boolean;
	}): Promise<void> {
		const { captureIsNoOp, marked, action, wasNewFile, linkOptions, isCanvasTriggered } = result;
		let cursor = result.cursor;
		// Commit success before links/navigation so later failures cannot invite duplicate writes.
		this.outcome.success(file, result.effect);

		if (this.plugin.settings.showCaptureNotification) {
			if (captureIsNoOp) {
				this.showNothingToCaptureNotice(file, {
					wasNewFile,
				});
			} else {
				this.showSuccessNotice(file, {
					wasNewFile,
					action,
				});
			}
		}

		await this.copyCapturedFileLinkToClipboard(file);

		if (cursor && linkOptions.enabled) {
			const rewriteTarget = linkOptions.destination.type === "specifiedFile"
				? getAppendLinkDestinationFile(this.app, linkOptions.destination)
				: placementSupportsFrontmatter(linkOptions.placement)
					? currentFile(this.app, this.choiceExecutor)
					: this.choiceExecutor.focusedProperty?.file;
			if (rewriteTarget?.path === file.path) cursor = null;
		}
		await this.insertCaptureLink(file, linkOptions, {
			isCanvasTriggered,
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
		if (isEditorAction(action)) {
			const parsed = captureIsNoOp ? captureContent : await templaterParseTemplate(this.app, captureContent, file);
			const payload = restoreUserTextInCapture(prepareCapture(parsed));
			if (payload.cursor.kind === "none" && hasCursorMarker(parsed)) {
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
					: insert(payload.content, this.app, file);
				if (!inserted) {
					await this.cleanupCreatedClipboardAttachments();
					this.outcome.fail(`Capture "${this.choice.name}": no active Markdown editor to insert into.`);
					return null;
				}
			}
			options.onCommit();
			return { effect: captureIsNoOp ? "unchanged" : "changed", captureIsNoOp, cursor, marked };
		}

		const { content: written, merged } = await writeNote(this.app, file, priorContent, newFileContent);
		options.onCommit();
		const wholeFileTemplater = this.choice.templater?.afterCapture === "wholeFile";
		if (wholeFileTemplater) {
			warnDeprecatedOnce(
				`templater-whole-file:${this.choice.id}`,
				`'${this.choice.name}' uses "Run Templater on entire destination file after capture", which is deprecated and will be removed in a future release. QuickAdd already runs Templater in what it captures. Turn the option off in the Capture's settings.`,
			);
			await overwriteTemplaterOnce(this.app, file);
		}
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
		let file = fileAlreadyExists ? getFileByPath(this.app, filePath) : undefined;
		this.formatter.setTitle(basenameWithoutMdOrCanvas(filePath));
		this.formatter.setTargetFolderPath(parentFolderPath(filePath));
		this.formatter.setDestinationSourcePath(filePath);
		if (file) this.formatter.setDestinationFile(file);
		this.formatter.setPromptRunContext({
			draftScopeId: this.choice.id, choiceName: this.choice.name,
			destination: filePath, destinationKind: "file",
		});

		const createWithTemplate = !file && this.choice.createFileIfItDoesntExist.createWithTemplate;
		let initialContent = file ? await readNote(this.app, file)
			: createWithTemplate ? "" : await this.periodicNoteContent(filePath) ?? "";
		let templateVars = new Map<string, unknown>();
		if (createWithTemplate) {
			({ content: initialContent, templateVars } = await this.renderCreateTemplate(filePath, linkOptions, false));
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
				const create = () => createFileWithInput(this.app, filePath, serializeCaptureFrontmatter(initialContent, frontmatter), {
					suppressTemplaterOnCreate: createWithTemplate,
				});
				file = createWithTemplate ? await create() : await createNoteAfterTemplaterTrigger(this.app, filePath, create);
			}
			args.onCommit();
			if (!fileAlreadyExists && (createWithTemplate || isTemplaterTriggerOnCreateEnabled(this.app))) {
				if (createWithTemplate) await overwriteTemplaterOnce(this.app, file);
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
		linkOptions: NormalizedAppendLinkOptions,
		markContentCommitted: () => void,
	): Promise<void> {
		if (isEditorAction(action)) {
			throw new ChoiceAbortError(
				"Canvas text cards support top, bottom, insert-after, and insert-before positions only.",
			);
		}

		if (this.createsMissingLineTargetAtCursor(action)) {
			throw new ChoiceAbortError(
				"Canvas text cards do not support creating missing line targets at cursor. Use top or bottom.",
			);
		}

		const file = target.canvasFile;
		this.formatter.setTitle(basenameWithoutMdOrCanvas(file.basename));
		this.formatter.setDestinationFile(file);

		const captureTemplate = this.getCaptureContent();
		const existingText = getCanvasTextCaptureContent(target);

		// Heading mode on a canvas text card picks from the card's own text, or the
		// formatter would abort on an empty `after`.
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

		// A blank capture leaves the card text unchanged.
		const captureIsNoOp = nextText === existingText;

		// Checked before the write: re-serialising the .canvas JSON can change its
		// bytes even when the card text is identical.
		if (!captureIsNoOp) {
			await setCanvasTextCaptureContent(this.app, target, nextText);
		}
		markContentCommitted();

		await this.finishCapture(file, {
			effect: captureIsNoOp ? "unchanged" : "changed", captureIsNoOp, cursor: null, marked: false,
			action, wasNewFile: false, linkOptions, isCanvasTriggered: true,
		});
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
	 * Heading-picker mode: asks for one of the destination's headings and makes
	 * its line the formatter's insert-after override. A custom heading is allowed
	 * only when "Create line if not found" is on, since otherwise the override
	 * could never match.
	 */
	private async maybeResolveInsertAfterHeading(content: string): Promise<void> {
		const insertAfter = this.choice.insertAfter;
		if (!insertAfter?.enabled || !insertAfter.promptHeading) return;

		const allowCreate = !!insertAfter.createIfNotFound;

		const lines = content.split("\n");
		// The headings Obsidian shows, minus setext ones: the picked line becomes
		// the insert-after target, and a setext heading's line is its text, so a
		// capture after it would split the heading from its underline. An ATX
		// line always differs from its text by the `#` marker.
		const headings = extractHeadingsFromLines(lines).filter(
			(h) => lines[h.line].trim() !== h.heading,
		);
		// Without indentation or a CRLF `\r`: the insert-after search compares
		// each note line with its leading whitespace trimmed, so an indented
		// heading's own line would never match.
		const headingLines = headings.map((h) => lines[h.line].trimStart().replace(/\r$/, ""));
		const headingDisplay = headings.map(
			(h) => `${"  ".repeat(Math.max(0, h.level - 1))}${h.heading}`,
		);
		const headingTexts = headings.map((h) => h.heading);

		const placeholder = "Choose a heading to insert under";
		const chosen = String(
			await routePrompt(this.choiceExecutor, {
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

		const pickedIndex = headingLines.indexOf(chosen);
		this.resolvedInsertAfterHeading =
			pickedIndex >= 0 ? headingTexts[pickedIndex] : chosen;
	}

	private isInsertAfterHeadingMode(): boolean {
		return (
			!!this.choice.insertAfter?.enabled &&
			!!this.choice.insertAfter.promptHeading
		);
	}

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
		const file: TFile = getFileByPath(this.app, filePath);
		if (!file) throw new Error("File not found");

		this.formatter.setTitle(file.basename);

		this.formatter.setDestinationFile(file);

		const formatted = await this.collectIfFrontmatter(
			() => this.formatter.formatContentOnly(content, { eachLine: this.choice.eachLine }),
		);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());

		const fileContent = await readNote(this.app, file);
		if (isCursorMarkerOnly(formatted)) {
			return { file, newFileContent: fileContent, captureContent: "", priorContent: fileContent, cursor: { kind: "none" }, markerOnly: true };
		}
		if (editorInsertion) {
			return { file, newFileContent: fileContent, captureContent: formatted, priorContent: fileContent, cursor: { kind: "none" } };
		}
		// The first pass ran every prompt before the note was read, so placement
		// starts from the note's current content. This step only runs Templater
		// and places the text; it does not format it again.
		const placement =
			await this.collectIfFrontmatter(() =>
				this.formatter.insertFormattedContent(
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

	/**
	 * The period and its settings when the capture creates the periodic note
	 * ({{DAILY}}, {{WEEKLY}}, ...) that Capture to named, or null.
	 */
	private periodicNoteFor(filePath: string): { period: Period; settings: PeriodicNoteSettings } | null {
		if (this.choice.captureToActiveFile || this.choice.createFileIfItDoesntExist.createWithTemplate) return null;
		const target = this.formatter.periodicNoteTarget;
		if (!target || `${target.path}.md` !== filePath) return null;
		return { period: target.period, settings: getPeriodicNoteSettings(this.app, target.period) };
	}

	/** The missing periodic note's first content: its template, filled the way its plugin fills it. */
	private async periodicNoteContent(filePath: string): Promise<string | null> {
		const note = this.periodicNoteFor(filePath);
		if (!note) return null;
		const template = await readPeriodicNoteTemplate(this.app, note.settings, note.period);
		if (template === null) return null;
		const clocks = this.choiceExecutor.clocks;
		return renderPeriodicNoteTemplate(template, note.settings, note.period,
			window.moment(clocks?.date ?? clocks?.now), window.moment(clocks?.now));
	}

	/**
	 * Renders the "Create file with template" body of a note this capture creates.
	 * The template engine has its own formatter, so it is given the destination
	 * and run context. Its draft scope is the template's own, so its {{VALUE}}
	 * prompt does not share the capture body prompt's draft key.
	 */
	private async renderCreateTemplate(
		filePath: string,
		linkOptions: { enabled: boolean; requireActiveFile?: boolean } | undefined,
		keepUserTextProtected: boolean,
	): Promise<{ content: string; templateVars: Map<string, unknown> }> {
		const templatePath = this.choice.createFileIfItDoesntExist.template;
		const engine = new SingleTemplateEngine(this.app, this.plugin, this.runtime, templatePath, this.choiceExecutor);
		if (linkOptions?.enabled && !linkOptions.requireActiveFile) engine.setLinkToCurrentFileBehavior("optional");
		engine.setDestinationPath(filePath);
		engine.setPromptRunContext({
			draftScopeId: `${this.choice.id}#${templatePath}`,
			choiceName: this.choice.name, destination: filePath, destinationKind: "file",
		});
		engine.choiceChain = this.chain;
		engine.setKeepUserTextProtected(keepUserTextProtected);
		const content = await engine.run();
		return { content, templateVars: engine.getAndClearTemplatePropertyVars() };
	}

	private async onCreateFileIfItDoesntExist(
		filePath: string,
		captureContent: string,
		linkOptions?: AppendLinkOptions,
	): Promise<CaptureWriteResult | null> {
		// Re-asserted at the one function that creates the file.
		assertCreatableFilePath(filePath);

		const fileBasename = basenameWithoutMdOrCanvas(filePath);
		this.formatter.setTitle(fileBasename);

		this.formatter.setDestinationSourcePath(filePath);

		// Format before the file exists so Templater never runs before `{{VALUE}}`
		// is substituted.
		const formattedCaptureContent: string =
			await this.collectIfFrontmatter(() =>
				this.formatter.formatContentOnly(captureContent, { eachLine: this.choice.eachLine }),
			);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());
		if (isCursorMarkerOnly(formattedCaptureContent)) {
			return null;
		}


		let fileContent = "";
		if (!this.choice.createFileIfItDoesntExist.createWithTemplate) {
			fileContent = await this.periodicNoteContent(filePath) ?? "";
		} else {
			// Answers to the template's prompts stay marked until Templater has run.
			const { content, templateVars } = await this.renderCreateTemplate(filePath, linkOptions, true);
			fileContent = content;

			log.logMessage(`CaptureChoiceEngine: Collected ${templateVars.size} template property variables`);
			if (templateVars.size > 0) {
				log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(', ')}`);
			}

			this.templatePropertyVars = templateVars;
		}

		// Create the new file with the (optional) template content. With a
		// QuickAdd template, Templater's new-file trigger is suppressed and the
		// template is rendered below; without one, the trigger may fill the note
		// first, so the capture is placed once it is done.
		const createWithTemplate = this.choice.createFileIfItDoesntExist.createWithTemplate;
		const create = () => createFileWithInput(this.app, filePath, fileContent, {
			suppressTemplaterOnCreate: createWithTemplate,
		});
		const file: TFile = createWithTemplate
			? await create()
			: await createNoteAfterTemplaterTrigger(this.app, filePath, create);

		try {
			if (this.choice.createFileIfItDoesntExist.createWithTemplate &&
				this.templatePropertyVars &&
				shouldPostProcessFrontMatter(file, this.templatePropertyVars)) {
				await postProcessFrontMatter(this.app, file, this.templatePropertyVars);
			}

			if (createWithTemplate && fileContent) {
				await overwriteTemplaterOnce(this.app, file);
			}
		} finally {
			if (fileContent) await this.restoreUserTextInNote(file);
		}

		// Read fresh: Templater may have rewritten the new file.
		const updatedFileContent: string = await this.app.vault.read(file);
		const placement =
			await this.collectIfFrontmatter(() =>
				this.formatter.insertFormattedContent(
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

	private async restoreUserTextInNote(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		if (restoreUserText(content) !== content) {
			await processNote(this.app, file, restoreUserText);
		}
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
