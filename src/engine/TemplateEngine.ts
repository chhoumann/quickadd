import { QuickAddEngine } from "./QuickAddEngine";
import { CompleteFormatter } from "../formatters/completeFormatter";
import type { LinkToCurrentFileBehavior } from "../formatters/formatter";
import type { App } from "obsidian";
import { Notice, TFile } from "obsidian";
import type QuickAdd from "../main";
import {
	getTemplater,
	overwriteTemplaterOnce,
	templaterParseTemplate,
} from "../utilityObsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputSuggester from "../gui/InputSuggester/inputSuggester";
import { MARKDOWN_FILE_EXTENSION_REGEX, CANVAS_FILE_EXTENSION_REGEX } from "../constants";
import { reportError } from "../utils/errorUtils";
import { basenameWithoutMdOrCanvas } from "../utils/pathUtils";
import { MacroAbortError } from "../errors/MacroAbortError";
import { isCancellationError } from "../utils/errorUtils";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";

type FolderChoiceOptions = {
	allowCreate?: boolean;
	placeholder?: string;
	allowedRoots?: string[];
	topItems?: Array<{ path: string; label: string }>;
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
		choiceFormatter?: IChoiceExecutor
	) {
		super(app);
		this.templater = getTemplater(app);
		this.formatter = new CompleteFormatter(app, plugin, choiceFormatter);
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

		while (true) {
			const raw = await this.promptForFolder(context);
			const selection = await this.resolveSelection(raw, context);

			if (selection.isEmpty) {
				if (!selection.isAllowed) {
					this.showFolderNotAllowedNotice(context.allowedRoots);
					continue;
				}
				return "";
			}

			if (!selection.isAllowed) {
				this.showFolderNotAllowedNotice(context.allowedRoots);
				continue;
			}

			await this.ensureFolderExists(selection);
			return selection.resolved;
		}
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
				throw new MacroAbortError("Input cancelled by user");
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
			return "";
		}

		await this.ensureFolderExists(selection);
		return selection.resolved;
	}

	private normalizeFolderPath(path: string): string {
		return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
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

	protected async getFormattedFilePath(
		folderPath: string,
		format: string,
		promptHeader: string
	): Promise<string> {
		const formattedName = await this.formatter.formatFileName(
			format,
			promptHeader
		);
		return this.normalizeMarkdownFilePath(folderPath, formattedName);
	}

	protected getTemplateExtension(templatePath: string): string {
		if (CANVAS_FILE_EXTENSION_REGEX.test(templatePath)) {
			return ".canvas";
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
		const formattedFileName: string = this.stripLeadingSlash(fileName)
			.replace(MARKDOWN_FILE_EXTENSION_REGEX, "")
			.replace(CANVAS_FILE_EXTENSION_REGEX, "");
		return `${actualFolderPath}${formattedFileName}${extension}`;
	}

	protected async incrementFileName(fileName: string) {
		const fileExists = await this.app.vault.adapter.exists(fileName);
		let newFileName = fileName;

		// Determine the extension from the filename and construct a matching regex
		const extension = CANVAS_FILE_EXTENSION_REGEX.test(fileName) ? ".canvas" : ".md";
		const extPattern = extension.replace(/\./g, "\\.");
		const numberWithExtRegex = new RegExp(`(\\d*)${extPattern}$`);
		const exec = numberWithExtRegex.exec(fileName);
		const numStr = exec?.[1];

		if (fileExists && numStr !== undefined) {
			if (numStr.length > 0) {
				const number = parseInt(numStr, 10);
				if (Number.isNaN(number)) {
					throw new Error("detected numbers but couldn't get them.");
				}
				newFileName = newFileName.replace(numberWithExtRegex, `${number + 1}${extension}`);
			} else {
				// No digits previously; insert 1 before extension
				newFileName = newFileName.replace(new RegExp(`${extPattern}$`), `1${extension}`);
			}
		} else if (fileExists) {
			// No match; simply append 1 before the extension
			newFileName = newFileName.replace(new RegExp(`${extPattern}$`), `1${extension}`);
		}

		const newFileExists = await this.app.vault.adapter.exists(newFileName);
		if (newFileExists)
			newFileName = await this.incrementFileName(newFileName);

		return newFileName;
	}

	protected async createFileWithTemplate(
		filePath: string,
		templatePath: string
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				templatePath
			);

				// Extract filename without extension from the full path (supports .md and .canvas)
				const fileBasename = basenameWithoutMdOrCanvas(filePath);
			this.formatter.setTitle(fileBasename);

			const formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);

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
			if (this.shouldPostProcessFrontMatter(createdFile, templateVars)) {
				await this.postProcessFrontMatter(createdFile, templateVars);
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



	protected async overwriteFileWithTemplate(
		file: TFile,
		templatePath: string
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				templatePath
			);

			// Use the existing file's basename as the title
			const fileBasename = file.basename;
			this.formatter.setTitle(fileBasename);

			const formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);

			// Get template variables before modifying the file
			const templateVars = this.formatter.getAndClearTemplatePropertyVars();

			log.logMessage(`TemplateEngine.overwriteFileWithTemplate: Collected ${templateVars.size} template property variables for ${file.path}`);
			if (templateVars.size > 0) {
				log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(', ')}`);
			}

			await this.app.vault.modify(file, formattedTemplateContent);

			// Post-process front matter for template property types BEFORE Templater
			if (this.shouldPostProcessFrontMatter(file, templateVars)) {
				await this.postProcessFrontMatter(file, templateVars);
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
		templatePath: string,
		section: "top" | "bottom"
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				templatePath
			);

			// Use the existing file's basename as the title
			const fileBasename = file.basename;
			this.formatter.setTitle(fileBasename);

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

	protected async getTemplateContent(templatePath: string): Promise<string> {
		let correctTemplatePath: string = this.stripLeadingSlash(templatePath);
		if (!MARKDOWN_FILE_EXTENSION_REGEX.test(templatePath) && 
			!CANVAS_FILE_EXTENSION_REGEX.test(templatePath))
			correctTemplatePath += ".md";

		const templateFile =
			this.app.vault.getAbstractFileByPath(correctTemplatePath);

		if (!(templateFile instanceof TFile))
			throw new Error(
				`Template file not found at path "${correctTemplatePath}".`
			);

		return await this.app.vault.cachedRead(templateFile);
	}
}
