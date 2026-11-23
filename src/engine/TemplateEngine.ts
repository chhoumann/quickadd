import type { EditorCursorPlacement } from "../utils/editorCursorPlacement";
import { prepareTemplateContent, rebaseTemplateCursor } from "../utils/templateCursorPlacement";
import { stripCursorMarkers } from "../utils/capturePlacement";
import { getBodyStartOffset } from "../utils/noteContentInsertion";
import { getMarkdownEditorViewForFile, setMarkdownCursorsAtOffsets } from "../utils/editorInsertion";
import { processNote } from "../utils/noteContent";
import { QuickAddEngine } from "./QuickAddEngine";
import { createFileWithInput, stripLeadingSlash } from "./vaultFiles";
import {
	postProcessFrontMatter,
	shouldPostProcessFrontMatter,
} from "./helpers/frontmatterPostProcessor";
import { CompleteFormatter } from "../formatters/completeFormatter";
import type {
	LinkToCurrentFileBehavior,
	TemplateInclusionState,
} from "../formatters/formatter";
import type { PromptRunContext } from "../formatters/promptScope";
import type { ChoiceChain } from "./choiceChain";
import type { App, TFile } from "obsidian";
import { TFolder } from "obsidian";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
import { getTemplateFile, resolveTemplatePath } from "../utils/templateFolderUtils";
import { overwriteTemplaterOnce } from "../utils/templaterIntegration";
import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";
import { reportError } from "../utils/errorUtils";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";
import { basenameWithoutMdOrCanvas, parentFolderPath } from "../utils/pathUtils";
import { MacroAbortError } from "../errors/MacroAbortError";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import { assertCreatableFilePath } from "./assertCreatableFilePath";
import { restoreUserTextAt } from "../formatters/helpers/userText";

export abstract class TemplateEngine extends QuickAddEngine {
	protected formatter: CompleteFormatter;
	protected cursorPlacement: EditorCursorPlacement | null = null;
	protected templaterCursorHandled = false;

	public hasTemplaterHandledCursor(): boolean {
		return this.templaterCursorHandled;
	}

	private async finishTemplateContent(file: TFile): Promise<void> {
		this.cursorPlacement = null;
		if (file.extension !== "md") return;
		let prepared = null as EditorCursorPlacement | null;
		await processNote(this.app, file, content => {
			const marked = prepareTemplateContent(content);
			prepared = restoreUserTextAt(marked.content, marked.offsets);
			return prepared.content;
		});
		this.cursorPlacement = prepared;
		if (this.cursorPlacement?.offsets.length === 0) this.cursorPlacement = null;
	}

	/**
	 * Finishes a note the template body was just written to: typed front matter,
	 * then Templater, then the cursor markers. The markers are cleaned even when
	 * an earlier step fails, without hiding that step's error.
	 */
	private async renderWrittenTemplate(file: TFile, templateVars: Map<string, unknown>): Promise<void> {
		let rendered = false;
		try {
			if (shouldPostProcessFrontMatter(file, templateVars)) {
				await postProcessFrontMatter(this.app, file, templateVars);
			}
			this.templaterCursorHandled = await overwriteTemplaterOnce(this.app, file);
			rendered = true;
		} finally {
			await this.finishTemplateContent(file).catch(error => {
				if (rendered) throw error;
				log.logWarning(`Unable to clean cursor markers in '${file.path}': ${String(error)}`);
			});
		}
	}

	public getCursorPlacement(): EditorCursorPlacement | null {
		return this.cursorPlacement;
	}

	public placeCursor(file: TFile, beforeLink?: EditorCursorPlacement | null): void {
		const editor = getMarkdownEditorViewForFile(this.app, file)?.editor;
		if (this.cursorPlacement && editor) {
			for (const cursor of [this.cursorPlacement, beforeLink]) {
				if (!cursor) continue;
				const placement = rebaseTemplateCursor(cursor, editor.getValue()) ?? cursor;
				if (setMarkdownCursorsAtOffsets(this.app, file,
					placement.offsets, placement.content)) return;
			}
		}
	}

	protected async rebaseCursorAfterFileChanges(file: TFile): Promise<void> {
		if (!this.cursorPlacement) return;
		try {
			this.cursorPlacement = rebaseTemplateCursor(
				this.cursorPlacement, await this.app.vault.read(file),
			);
		} catch {
			this.cursorPlacement = null;
			log.logMessage(`Unable to verify cursor position in '${file.path}'.`);
		}
	}

	protected constructor(
		app: App,
		protected plugin: ChoiceRuntimePlugin,
		protected readonly runtime: FormatterExecutionRuntime,
		choiceExecutor?: IChoiceExecutor,
		inclusion?: TemplateInclusionState,
	) {
		super(app);
		this.formatter = new CompleteFormatter(app, plugin, choiceExecutor, runtime);
		if (inclusion) {
			this.formatter.setTemplateInclusionState(inclusion);
		}
	}

	public abstract run():
		| Promise<void>
		| Promise<string>
		| Promise<{ file: TFile; content: string }>;


	/**
	 * Strips the target folder from the start of a formatted file name so
	 * formats like `Meetings/{{VALUE}}` with a `Meetings` folder don't
	 * produce `Meetings/Meetings/...`.
	 */
	protected stripDuplicateFolderPrefix(
		fileName: string,
		folderPath: string,
	): { fileName: string; strippedPrefix: boolean } {
		const normalizedFolder = stripLeadingSlash(folderPath);
		const normalizedFileName = stripLeadingSlash(fileName);

		if (!normalizedFolder) {
			return { fileName: normalizedFileName, strippedPrefix: false };
		}
		if (!normalizedFileName.startsWith(`${normalizedFolder}/`)) {
			return { fileName: normalizedFileName, strippedPrefix: false };
		}

		return {
			fileName: normalizedFileName.slice(normalizedFolder.length + 1),
			strippedPrefix: true,
		};
	}

	/**
	 * When no folder is configured, a formatted name containing a path is
	 * treated as vault-relative if it is absolute or its first segment is an
	 * existing root folder.
	 */
	protected shouldTreatFormattedNameAsVaultRelativePath(
		formattedName: string,
		strippedPrefix: boolean,
		folderEnabled: boolean,
	): boolean {
		if (folderEnabled) return false;
		if (strippedPrefix) return false;

		const normalizedFileName = formattedName.trim();
		if (!normalizedFileName.includes("/")) return false;
		if (normalizedFileName.startsWith("./")) return false;

		if (normalizedFileName.startsWith("/")) return true;

		const [firstSegment] = stripLeadingSlash(normalizedFileName).split("/");
		if (!firstSegment) return false;

		const rootEntry = this.app.vault.getAbstractFileByPath(firstSegment);
		return rootEntry instanceof TFolder;
	}

	protected getTemplateExtension(templatePath: string): string {
		templatePath = resolveTemplatePath(templatePath);
		if (CANVAS_FILE_EXTENSION_REGEX.test(templatePath)) {
			return ".canvas";
		}
		if (BASE_FILE_EXTENSION_REGEX.test(templatePath)) {
			return ".base";
		}
		return ".md";
	}

	protected normalizeTemplateFilePath(
		folderPath: string,
		fileName: string,
		templatePath: string
	): string {
		const safeFolderPath = stripLeadingSlash(folderPath);
		const actualFolderPath: string = safeFolderPath ? `${safeFolderPath}/` : "";
		const extension = this.getTemplateExtension(templatePath);
		const normalizedFileName = normalizeGeneratedFilePath(
			stripLeadingSlash(fileName),
			"File name",
		);
		const formattedFileName: string = normalizeGeneratedFilePath(
			normalizedFileName
				.replace(MARKDOWN_FILE_EXTENSION_REGEX, "")
				.replace(CANVAS_FILE_EXTENSION_REGEX, "")
				.replace(BASE_FILE_EXTENSION_REGEX, ""),
			"File name",
		);
		// Validate the final path segment, not just the whole string — a
		// trailing-slash name like "Projects/" (optional leaf token left
		// empty) would otherwise still produce "Projects/.md".
		const baseName = formattedFileName.slice(
			formattedFileName.lastIndexOf("/") + 1
		);
		if (!baseName.trim()) {
			throw new Error(
				"File name is empty after formatting. Make sure the tokens in the file name format produce a value (an optional token left empty can cause this)."
			);
		}
		const assembledPath = `${actualFolderPath}${formattedFileName}${extension}`;
		// Contain the assembled path here: the folder portion (possibly from an
		// untrusted synced choice) is not normalized like the name, and the
		// relocation flow would otherwise move the note outside the vault.
		if (escapesVaultBoundary(assembledPath)) {
			throw new Error(
				`Refusing to build a file path outside the vault: "${assembledPath}".`,
			);
		}
		return assembledPath;
	}

	/**
	 * Why the last template write failed. The write helpers report the cause and
	 * return null, so callers that record the run's outcome read it here. Every
	 * report-and-return-null helper must set it.
	 */
	protected lastTemplateFileFailure: string | null = null;

	/** Record the cause a report-and-return-null helper is about to swallow. */
	protected noteTemplateFileFailure(err: unknown, fallback: string): void {
		this.lastTemplateFileFailure =
			err instanceof Error && err.message ? err.message : fallback;
	}

	private setTemplateDestination(path: string, title: string): void {
		this.formatter.setTitle(title);
		this.formatter.setTargetFolderPath(parentFolderPath(path));
		this.formatter.setPromptRunContext({ destination: path, destinationKind: "file" });
	}

	private async prepareTemplateBody(template: string, path: string, title: string,
		operation: "createFileWithTemplate" | "overwriteFileWithTemplate") {
		this.setTemplateDestination(path, title);
		const markdown = path.toLowerCase().endsWith(".md");
		// Markdown keeps user text marked until finishTemplateContent, after Templater.
		const content = await this.formatter.withTemplatePropertyCollection(() =>
			this.formatter.withPromptScope("noteBody", template, () =>
				markdown
					? this.formatter.withUserTextProtected(() => this.formatter.formatTemplateContent(template))
					: this.formatter.formatFileContent(template)));
		const variables = this.formatter.getAndClearTemplatePropertyVars();
		log.logMessage(`TemplateEngine.${operation}: Collected ${variables.size} template property variables for ${path}`);
		if (variables.size > 0) {
			log.logMessage(`Variables: ${Array.from(variables.keys()).join(', ')}`);
		}
		this.cursorPlacement = null;
		this.templaterCursorHandled = false;
		const bodyStart = getBodyStartOffset(content);
		const prepared = path.toLowerCase().endsWith(".md")
			? stripCursorMarkers(content.slice(0, bodyStart)) + content.slice(bodyStart)
			: stripCursorMarkers(content);
		return { content: prepared, variables };
	}

	protected async createFileWithTemplate(
		filePath: string,
		resolvedTemplatePath: string
	) {
		// Clear the previous run's swallowed cause first, so the reset happens even
		// when the guard below aborts.
		this.lastTemplateFileFailure = null;

		// Refuse a name Obsidian rejects before the template is read, so the user is
		// not asked every prompt and inline scripts do not run for a doomed create.
		// Throws its own ChoiceAbortError rather than recording into
		// lastTemplateFileFailure.
		assertCreatableFilePath(filePath);

		try {
			const templateContent: string = await this.getTemplateContent(
				resolvedTemplatePath
			);

			const { content: formattedTemplateContent, variables: templateVars } =
				await this.prepareTemplateBody(templateContent, filePath,
					basenameWithoutMdOrCanvas(filePath), "createFileWithTemplate");

			const suppressTemplaterOnCreate = filePath
				.toLowerCase()
				.endsWith(".md");
			const createdFile: TFile = await createFileWithInput(
				this.app,
				filePath,
				formattedTemplateContent,
				{ suppressTemplaterOnCreate },
			);

			await this.renderWrittenTemplate(createdFile, templateVars);
			return createdFile;
		} catch (err) {
			if (err instanceof MacroAbortError) {
				throw err;
			}
			this.noteTemplateFileFailure(
				err,
				`Could not create file with template at ${filePath}`,
			);
			reportError(err, `Could not create file with template at ${filePath}`);
			return null;
		}
	}

	public setLinkToCurrentFileBehavior(behavior: LinkToCurrentFileBehavior) {
		this.formatter.setLinkToCurrentFileBehavior(behavior);
	}

	/**
	 * Sets the folder {{FOLDER}} resolves to for this engine's formatter. Used by
	 * callers that drive an engine they don't own the formatter of — notably
	 * CaptureChoiceEngine threading the destination folder into the
	 * SingleTemplateEngine that renders a "create with template" body.
	 */
	public setTargetFolderPath(path: string | null) {
		this.formatter.setTargetFolderPath(path);
	}

	/**
	 * Propagates the run context into this engine's own formatter, so prompts
	 * raised from a nested template still say which choice is asking and where
	 * its output lands.
	 */
	public setPromptRunContext(context: PromptRunContext) {
		this.formatter.setPromptRunContext(context);
	}

	/** See {@link CompleteFormatter.choiceChain}. */
	public get choiceChain(): ChoiceChain {
		return this.formatter.choiceChain;
	}

	public set choiceChain(chain: ChoiceChain) {
		this.formatter.choiceChain = chain;
	}

	/**
	 * Resolves format tokens in a template source path via this engine's
	 * formatter. Call once at run() entry and reuse the result for both the
	 * target path and the content read, so they never disagree; resolving again
	 * would re-evaluate {{date}}/{{random}}.
	 */
	protected async resolveTemplateSourcePath(rawPath: string): Promise<string> {
		return this.formatter.formatTemplateFilePath(rawPath);
	}



	protected async overwriteFileWithTemplate(
		file: TFile,
		resolvedTemplatePath: string
	) {
		this.lastTemplateFileFailure = null;
		try {
			const templateContent: string = await this.getTemplateContent(
				resolvedTemplatePath
			);

			const { content: formattedTemplateContent, variables: templateVars } =
				await this.prepareTemplateBody(templateContent, file.path,
					file.basename, "overwriteFileWithTemplate");

			await processNote(this.app, file, () => formattedTemplateContent);

			await this.renderWrittenTemplate(file, templateVars);
			return file;
		} catch (err) {
			if (err instanceof MacroAbortError) {
				throw err;
			}
			this.noteTemplateFileFailure(err, "Could not overwrite file with template");
			reportError(err, "Could not overwrite file with template");
			return null;
		}
	}

	/**
	 * Reads a template's content. The path MUST already be resolved via
	 * {@link resolveTemplateSourcePath} — every caller resolves at run() entry.
	 * This method intentionally does not format, so {{date}}/{{random}} in a
	 * template path won't re-evaluate between extension derivation and reading.
	 */
	protected async getTemplateContent(resolvedTemplatePath: string): Promise<string> {
		const templateFile = getTemplateFile(this.app, resolvedTemplatePath);

		if (!templateFile)
			throw new Error(
				`Template file not found at path "${resolvedTemplatePath}".`
			);

		return await this.app.vault.cachedRead(templateFile);
	}
}
