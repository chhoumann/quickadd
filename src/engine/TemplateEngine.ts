import type { EditorCursorPlacement } from "../utils/editorCursorPlacement";
import { prepareTemplateContent, rebaseTemplateCursor } from "../utils/templateCursorPlacement";
import { setMarkdownCursorsAtOffsets } from "../utils/editorInsertion";
import { FolderSelectionEngine } from "./FolderSelectionEngine";
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
import type { App, TFile } from "obsidian";
import { TFolder } from "obsidian";
import type QuickAdd from "../main";
import {
	getTemplateFile,
	getTemplater,
	overwriteTemplaterOnce,
	templaterParseTemplate,
} from "../utilityObsidian";
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

function isMacroAbortError(error: unknown): error is MacroAbortError {
	return (
		error instanceof MacroAbortError ||
		(Boolean(error) &&
			typeof error === "object" &&
			"name" in (error as Record<string, unknown>) &&
			(error as { name?: string }).name === "MacroAbortError")
	);
}

export abstract class TemplateEngine extends FolderSelectionEngine {
	protected formatter: CompleteFormatter;
	protected readonly templater;
	protected cursorPlacement: EditorCursorPlacement | null = null;

	public getCursorPlacement(): EditorCursorPlacement | null {
		return this.cursorPlacement;
	}

	public placeCursor(file: TFile): void {
		if (this.cursorPlacement) {
			setMarkdownCursorsAtOffsets(this.app, file,
				this.cursorPlacement.offsets, this.cursorPlacement.content);
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
		protected plugin: QuickAdd,
		choiceFormatter?: IChoiceExecutor,
		inclusion?: TemplateInclusionState,
	) {
		super(app);
		this.templater = getTemplater(app);
		this.formatter = new CompleteFormatter(app, plugin, choiceFormatter);
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
		const normalizedFolder = this.stripLeadingSlash(folderPath);
		const normalizedFileName = this.stripLeadingSlash(fileName);

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

		const [firstSegment] = this.stripLeadingSlash(normalizedFileName).split("/");
		if (!firstSegment) return false;

		const rootEntry = this.app.vault.getAbstractFileByPath(firstSegment);
		return rootEntry instanceof TFolder;
	}

	protected getTemplateExtension(templatePath: string): string {
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
		const safeFolderPath = this.stripLeadingSlash(folderPath);
		const actualFolderPath: string = safeFolderPath ? `${safeFolderPath}/` : "";
		const extension = this.getTemplateExtension(templatePath);
		const normalizedFileName = normalizeGeneratedFilePath(
			this.stripLeadingSlash(fileName),
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
		// Contain the assembled target at this shared chokepoint. The file NAME is run
		// through normalizeGeneratedFilePath above, but the FOLDER portion is only
		// stripLeadingSlash'd — so a folder like "../../../evil" (from an untrusted,
		// synced Template choice resolved via formatFolderPath) would assemble an
		// out-of-vault path. Both callers act on it without a sink guard: the relocation
		// flow (computeChoiceTargetPath -> createFolder + fileManager.renameFile) would
		// otherwise move the active note OUTSIDE the vault. Reject any escape here so
		// every caller of this assembler is contained.
		if (escapesVaultBoundary(assembledPath)) {
			throw new Error(
				`Refusing to build a file path outside the vault: "${assembledPath}".`,
			);
		}
		return assembledPath;
	}

	/**
	 * Why the last template write failed.
	 *
	 * Each of the write helpers below reports the real cause ("Template file not found at
	 * path …") and then returns null, so its caller only knew THAT the write failed, not
	 * why - and the caller is what records the run's outcome. A remote client was told
	 * "Choice execution failed; no file was created." while the actionable sentence went
	 * to a desktop notice nobody was watching (#1603).
	 *
	 * Every helper that reports-and-returns-null sets this, so a new one that forgets is
	 * the only way back to a vague outcome.
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
		const content = await this.formatter.withTemplatePropertyCollection(() =>
			this.formatter.withPromptScope("noteBody", template, () =>
				path.toLowerCase().endsWith(".md")
					? this.formatter.formatTemplateContent(template)
					: this.formatter.formatFileContent(template)));
		const variables = this.formatter.getAndClearTemplatePropertyVars();
		log.logMessage(`TemplateEngine.${operation}: Collected ${variables.size} template property variables for ${path}`);
		if (variables.size > 0) {
			log.logMessage(`Variables: ${Array.from(variables.keys()).join(', ')}`);
		}
		const prepared = prepareTemplateContent(content);
		this.cursorPlacement = path.toLowerCase().endsWith(".md") && prepared.offsets.length > 0 ? prepared : null;
		return { content: prepared.content, variables };
	}

	protected async createFileWithTemplate(
		filePath: string,
		resolvedTemplatePath: string
	) {
		// Clear the previous run's swallowed cause FIRST, so the reset is
		// unconditional even when the guard below aborts (#1617).
		this.lastTemplateFileFailure = null;

		// Then, before the template is read and long before its body is formatted
		// (#1591). Both production callers - TemplateChoiceEngine's `else` branch of
		// `vault.adapter.exists`, and its freshly incremented collision name - are
		// paths where nothing is at `filePath` yet, so a name Obsidian refuses can
		// only end in a failed `vault.create`. Letting it get that far means the
		// user answers the whole prompt chain and their inline scripts run first,
		// and QuickAddEngine.createFileWithInput leaves the target folder behind.
		//
		// It THROWS rather than recording into lastTemplateFileFailure: that field
		// is for helpers that report-and-return-null, while this aborts the choice
		// with a typed ChoiceAbortError carrying its own actionable message (#1606).
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
			const createdFile: TFile = await this.createFileWithInput(
				filePath,
				formattedTemplateContent,
				{ suppressTemplaterOnCreate },
			);

			// Post-process front matter for template property types BEFORE Templater
			if (shouldPostProcessFrontMatter(createdFile, templateVars)) {
				await postProcessFrontMatter(this.app, createdFile, templateVars);
			}

			// Process Templater commands for template choices
			await overwriteTemplaterOnce(this.app, createdFile);
			await this.rebaseCursorAfterFileChanges(createdFile);

			return createdFile;
		} catch (err) {
			if (isMacroAbortError(err)) {
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
	 * Propagates "which choice is asking, and where its output lands" into this
	 * engine's own formatter, so prompts raised from a nested template
	 * ({{TEMPLATE:...}} inclusion, or a capture creating its target file from a
	 * template) still carry the run context (issue #1546).
	 */
	public setPromptRunContext(context: PromptRunContext) {
		this.formatter.setPromptRunContext(context);
	}

	/**
	 * Resolves QuickAdd format tokens in a template *source* path (issue #620)
	 * via this engine's formatter, e.g. "Templates/{{value:type}} Template.md".
	 * Call once at run() entry and reuse the result for BOTH target-path
	 * construction (extension/name) and content reading, so the file that is
	 * read and the file that is created can never disagree. Resolving more than
	 * once would re-evaluate {{date}}/{{random}} to a different value.
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

			await this.app.vault.modify(file, formattedTemplateContent);

			// Post-process front matter for template property types BEFORE Templater
			if (shouldPostProcessFrontMatter(file, templateVars)) {
				await postProcessFrontMatter(this.app, file, templateVars);
			}

			// Process Templater commands
			await overwriteTemplaterOnce(this.app, file);
			await this.rebaseCursorAfterFileChanges(file);

			return file;
		} catch (err) {
			if (isMacroAbortError(err)) {
				throw err;
			}
			this.noteTemplateFileFailure(err, "Could not overwrite file with template");
			reportError(err, "Could not overwrite file with template");
			return null;
		}
	}

	protected async appendToFileWithTemplate(
		file: TFile,
		resolvedTemplatePath: string,
		section: "top" | "bottom"
	) {
		this.lastTemplateFileFailure = null;
		try {
			const templateContent: string = await this.getTemplateContent(
				resolvedTemplatePath
			);

			this.setTemplateDestination(file.path, file.basename);

			let formattedTemplateContent: string = await this.formatter.withPromptScope(
				"noteBody",
				templateContent,
				() => this.formatter.formatFileContent(templateContent),
			);
			if (file.extension === "md") {
				formattedTemplateContent = await templaterParseTemplate(
					this.app,
					formattedTemplateContent,
					file,
				);
			}
			const fileContent: string = await this.app.vault.cachedRead(file);
			const newFileContent: string =
				section === "top"
					? `${formattedTemplateContent}\n${fileContent}`
					: `${fileContent}\n${formattedTemplateContent}`;
			await this.app.vault.modify(file, newFileContent);

			return file;
		} catch (err) {
			if (isMacroAbortError(err)) {
				throw err;
			}
			this.noteTemplateFileFailure(err, "Could not append to file with template");
			reportError(err, "Could not append to file with template");
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
