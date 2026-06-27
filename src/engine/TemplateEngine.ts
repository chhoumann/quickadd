import { QuickAddEngine } from "./QuickAddEngine";
import {
	postProcessFrontMatter,
	shouldPostProcessFrontMatter,
} from "./helpers/frontmatterPostProcessor";
import { CompleteFormatter } from "../formatters/completeFormatter";
import type {
	LinkToCurrentFileBehavior,
	TemplateInclusionState,
} from "../formatters/formatter";
import type { App, TFile } from "obsidian";
import { Notice, TFolder } from "obsidian";
import type QuickAdd from "../main";
import {
	getTemplateFile,
	getTemplater,
	overwriteTemplaterOnce,
	templaterParseTemplate,
} from "../utilityObsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputSuggester from "../gui/InputSuggester/inputSuggester";
import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";
import { reportError } from "../utils/errorUtils";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";
import { basenameWithoutMdOrCanvas, parentFolderPath } from "../utils/pathUtils";
import {
	INVALID_FOLDER_CHARS_REGEX,
	INVALID_FOLDER_CONTROL_CHARS_REGEX,
	INVALID_FOLDER_TRAILING_CHARS_REGEX,
	isReservedWindowsDeviceName,
} from "../utils/pathValidation";
import { MacroAbortError } from "../errors/MacroAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { isCancellationError } from "../utils/errorUtils";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";

type FolderChoiceOptions = {
	allowCreate?: boolean;
	placeholder?: string;
	allowedRoots?: string[];
	topItems?: Array<{ path: string; label: string }>;
	/**
	 * When `false`, refuse to open the folder-chooser suggester (no one can answer
	 * it in a non-interactive CLI run) and abort with a clear error instead of
	 * hanging. Defaults to interactive. A single configured folder never prompts,
	 * so it is unaffected regardless of this flag.
	 */
	interactive?: boolean;
};

type FolderSelectionContext = {
	items: string[];
	displayItems: string[];
	normalizedItems: string[];
	canonicalByNormalized: Map<string, string>;
	displayByNormalized: Map<string, string>;
	existingSet: Set<string>;
	allowCreate: boolean;
	allowedRoots: string[];
	placeholder?: string;
};

type FolderSelection = {
	raw: string;
	normalized: string;
	resolved: string;
	exists: boolean;
	isAllowed: boolean;
	isEmpty: boolean;
};

class InvalidFolderPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidFolderPathError";
	}
}

function isMacroAbortError(error: unknown): error is MacroAbortError {
	return (
		error instanceof MacroAbortError ||
		(Boolean(error) &&
			typeof error === "object" &&
			"name" in (error as Record<string, unknown>) &&
			(error as { name?: string }).name === "MacroAbortError")
	);
}

export abstract class TemplateEngine extends QuickAddEngine {
	protected formatter: CompleteFormatter;
	protected readonly templater;

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

	protected async getOrCreateFolder(
		folders: string[],
		options: FolderChoiceOptions = {},
	): Promise<string> {
		const context = this.buildFolderSelectionContext(folders, options);

		if (!this.shouldPromptForFolder(context)) {
			return await this.handleSingleSelection(context);
		}

		// Non-interactive run (CLI without `ui`): the folder chooser has no one to
		// answer it, so opening it would hang. Abort with an actionable error.
		if (options.interactive === false) {
			throw new ChoiceAbortError(
				"This choice needs to ask which folder to create the note in, but this run is non-interactive. " +
					"Configure a single target folder, or re-run with the ui flag.",
			);
		}

		const selection = await this.promptUntilAllowed(context);
		return selection.isEmpty ? "" : selection.resolved;
	}

	private buildFolderSelectionContext(
		folders: string[],
		options: FolderChoiceOptions,
	): FolderSelectionContext {
		const allowCreate = options.allowCreate ?? false;
		const allowedRoots =
			options.allowedRoots?.map((root) => this.normalizeFolderPath(root)) ?? [];

		const {
			items,
			displayItems,
			normalizedItems,
			canonicalByNormalized,
			displayByNormalized,
		} = this.buildFolderSuggestions(
			folders,
			options.topItems ?? [],
			allowedRoots.length > 0 ? allowedRoots : undefined,
		);

		return {
			items,
			displayItems,
			normalizedItems,
			canonicalByNormalized,
			displayByNormalized,
			existingSet: new Set(normalizedItems),
			allowCreate,
			allowedRoots,
			placeholder: options.placeholder,
		};
	}

	private shouldPromptForFolder(context: FolderSelectionContext): boolean {
		return (
			context.items.length > 1 ||
			(context.allowCreate && context.items.length === 0)
		);
	}

	private async promptForFolder(context: FolderSelectionContext): Promise<string> {
		try {
			if (context.allowCreate) {
				return await InputSuggester.Suggest(
					this.app,
					context.displayItems,
					context.items,
					{
						placeholder:
							context.placeholder ?? "Choose a folder or type to create one",
						renderItem: (item, el) => {
							this.renderFolderSuggestion(
								item,
								el,
								context.existingSet,
								context.displayByNormalized,
							);
						},
					},
				);
			}

			return await GenericSuggester.Suggest(
				this.app,
				context.displayItems,
				context.items,
				context.placeholder,
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
	}

	private async resolveSelection(
		raw: string,
		context: FolderSelectionContext,
	): Promise<FolderSelection> {
		const normalized = this.normalizeFolderPath(raw);
		const isEmpty = normalized.length === 0;
		const canonical = context.canonicalByNormalized.get(normalized);
		const resolved = canonical ?? normalized;

		const exists = isEmpty
			? false
			: canonical !== undefined ||
				(await this.app.vault.adapter.exists(resolved));

		const isAllowed =
			context.allowedRoots.length === 0
				? true
				: this.isPathAllowed(isEmpty ? "" : resolved, context.allowedRoots);

		return {
			raw,
			normalized,
			resolved,
			exists,
			isAllowed,
			isEmpty,
		};
	}

	private async promptUntilAllowed(
		context: FolderSelectionContext,
	): Promise<FolderSelection> {
		// Keep prompting until the user provides an allowed selection or cancels.
		for (;;) {
			const raw = await this.promptForFolder(context);
			const selection = await this.resolveSelection(raw, context);

			if (selection.isEmpty) {
				if (!selection.isAllowed) {
					this.showFolderNotAllowedNotice(context.allowedRoots);
					continue;
				}
				return selection;
			}

			if (!selection.isAllowed) {
				this.showFolderNotAllowedNotice(context.allowedRoots);
				continue;
			}

			try {
				this.validateFolderPath(selection.resolved);
			} catch (error) {
				if (error instanceof InvalidFolderPathError) {
					new Notice(error.message);
					continue;
				}
				throw error;
			}

			await this.ensureFolderExists(selection);

			return selection;
		}
	}

	private async ensureFolderExists(selection: FolderSelection): Promise<void> {
		if (selection.isEmpty || selection.exists) return;
		await this.createFolder(selection.resolved);
	}

	private async handleSingleSelection(
		context: FolderSelectionContext,
	): Promise<string> {
		const raw = context.items[0] ?? "";
		const selection = await this.resolveSelection(raw, context);

		if (selection.isEmpty) return "";
		if (!selection.isAllowed) {
			this.showFolderNotAllowedNotice(context.allowedRoots);
			throw new MacroAbortError("Selected folder not allowed.");
		}

		if (selection.resolved) {
			try {
				this.validateFolderPath(selection.resolved);
			} catch (error) {
				if (error instanceof InvalidFolderPathError) {
					new Notice(error.message);
					return "";
				}
				throw error;
			}
		}

		await this.ensureFolderExists(selection);
		return selection.resolved;
	}

	private normalizeFolderPath(path: string): string {
		return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
	}

	private validateFolderPath(path: string): void {
		const trimmed = path.trim();
		if (!trimmed) return;

		const segments = trimmed.split("/");
		for (const segment of segments) {
			this.validateFolderSegment(segment);
		}
	}

	private validateFolderSegment(segment: string): void {
		if (!segment) {
			throw new InvalidFolderPathError("Folder name cannot be empty.");
		}

		if (segment === "." || segment === "..") {
			throw new InvalidFolderPathError("Folder name cannot be '.' or '..'.");
		}

		if (INVALID_FOLDER_CONTROL_CHARS_REGEX.test(segment)) {
			throw new InvalidFolderPathError(
				"Folder name cannot contain control characters.",
			);
		}

		if (INVALID_FOLDER_CHARS_REGEX.test(segment)) {
			throw new InvalidFolderPathError(
				"Folder name cannot contain any of the following characters: \\ / : * ? \" < > |",
			);
		}

		if (INVALID_FOLDER_TRAILING_CHARS_REGEX.test(segment)) {
			throw new InvalidFolderPathError(
				"Folder name cannot end with a space or a period.",
			);
		}

		const normalized = segment.replace(/[. ]+$/u, "");
		const base = normalized.split(".")[0] ?? "";
		if (base && isReservedWindowsDeviceName(base)) {
			throw new InvalidFolderPathError(
				"Folder name cannot be a reserved name like CON, PRN, AUX, NUL, COM1-9, or LPT1-9.",
			);
		}
	}

	private isPathAllowed(path: string, roots: string[]): boolean {
		const normalizedPath = this.normalizeFolderPath(path);
		for (const root of roots) {
			if (!root) return true;
			if (normalizedPath === root) return true;
			if (normalizedPath.startsWith(`${root}/`)) return true;
		}
		return false;
	}

	private showFolderNotAllowedNotice(roots: string[]): void {
		const displayRoots = roots.map((root) => (root ? root : "/"));
		const list =
			displayRoots.length > 3
				? `${displayRoots.slice(0, 3).join(", ")}...`
				: displayRoots.join(", ");
		new Notice(`Folder must be under: ${list}`);
	}

	private buildFolderSuggestions(
		folders: string[],
		topItems: Array<{ path: string; label: string }>,
		allowedRoots?: string[],
	): {
		items: string[];
		displayItems: string[];
		normalizedItems: string[];
		canonicalByNormalized: Map<string, string>;
		displayByNormalized: Map<string, string>;
	} {
		const items: string[] = [];
		const displayItems: string[] = [];
		const normalizedItems: string[] = [];
		const canonicalByNormalized = new Map<string, string>();
		const displayByNormalized = new Map<string, string>();
		const seen = new Set<string>();

		const addItem = (path: string, label?: string) => {
			const normalized = this.normalizeFolderPath(path);
			if (seen.has(normalized)) return;
			if (
				allowedRoots &&
				allowedRoots.length > 0 &&
				!this.isPathAllowed(normalized, allowedRoots)
			) {
				return;
			}
			seen.add(normalized);
			items.push(path);
			displayItems.push(label ?? path);
			normalizedItems.push(normalized);
			canonicalByNormalized.set(normalized, path);
			if (label) displayByNormalized.set(normalized, label);
		};

		for (const item of topItems) addItem(item.path, item.label);
		for (const folder of folders) addItem(folder);

		return {
			items,
			displayItems,
			normalizedItems,
			canonicalByNormalized,
			displayByNormalized,
		};
	}

	private renderFolderSuggestion(
		item: string,
		el: HTMLElement,
		existingSet: Set<string>,
		displayByNormalized: Map<string, string>,
	): void {
		el.empty();
		el.classList.add("mod-complex");
		const normalized = this.normalizeFolderPath(item);
		const display = displayByNormalized.get(normalized);
		const displayPath = item || "/";
		const isExisting = existingSet.has(normalized);
		let indicator = "";

		if (display === "<current folder>") {
			indicator = "Current folder";
		} else if (!isExisting) {
			indicator = "Create folder";
		}

		const content = el.createDiv("suggestion-content");
		const title = content.createDiv("suggestion-title");
		title.createSpan({ text: displayPath });

		if (indicator) {
			const aux = el.createDiv("suggestion-aux");
			aux.createEl("kbd", { cls: "suggestion-hotkey", text: indicator });
		}
	}

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
		return `${actualFolderPath}${formattedFileName}${extension}`;
	}

	protected async createFileWithTemplate(
		filePath: string,
		resolvedTemplatePath: string
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				resolvedTemplatePath
			);

			// Extract filename without extension from the full path.
			const fileBasename = basenameWithoutMdOrCanvas(filePath);
			this.formatter.setTitle(fileBasename);
			// {{FOLDER}} in the body reflects the file's actual on-disk folder.
			this.formatter.setTargetFolderPath(parentFolderPath(filePath));

			const formattedTemplateContent: string =
				await this.formatter.withTemplatePropertyCollection(() =>
					this.formatter.formatFileContent(templateContent),
				);

			// Get template variables before creating the file
			const templateVars = this.formatter.getAndClearTemplatePropertyVars();

			log.logMessage(`TemplateEngine.createFileWithTemplate: Collected ${templateVars.size} template property variables for ${filePath}`);
			if (templateVars.size > 0) {
				log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(', ')}`);
			}

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

			return createdFile;
		} catch (err) {
			if (isMacroAbortError(err)) {
				throw err;
			}
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
		try {
			const templateContent: string = await this.getTemplateContent(
				resolvedTemplatePath
			);

			// Use the existing file's basename as the title
			const fileBasename = file.basename;
			this.formatter.setTitle(fileBasename);
			// {{FOLDER}} reflects the existing file's folder, which can differ
			// from the choice's configured folder.
			this.formatter.setTargetFolderPath(parentFolderPath(file.path));

			const formattedTemplateContent: string =
				await this.formatter.withTemplatePropertyCollection(() =>
					this.formatter.formatFileContent(templateContent),
				);

			// Get template variables before modifying the file
			const templateVars = this.formatter.getAndClearTemplatePropertyVars();

			log.logMessage(`TemplateEngine.overwriteFileWithTemplate: Collected ${templateVars.size} template property variables for ${file.path}`);
			if (templateVars.size > 0) {
				log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(', ')}`);
			}

			await this.app.vault.modify(file, formattedTemplateContent);

			// Post-process front matter for template property types BEFORE Templater
			if (shouldPostProcessFrontMatter(file, templateVars)) {
				await postProcessFrontMatter(this.app, file, templateVars);
			}

			// Process Templater commands
			await overwriteTemplaterOnce(this.app, file);

			return file;
		} catch (err) {
			if (isMacroAbortError(err)) {
				throw err;
			}
			reportError(err, "Could not overwrite file with template");
			return null;
		}
	}

	protected async appendToFileWithTemplate(
		file: TFile,
		resolvedTemplatePath: string,
		section: "top" | "bottom"
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				resolvedTemplatePath
			);

			// Use the existing file's basename as the title
			const fileBasename = file.basename;
			this.formatter.setTitle(fileBasename);
			this.formatter.setTargetFolderPath(parentFolderPath(file.path));

			let formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);
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
