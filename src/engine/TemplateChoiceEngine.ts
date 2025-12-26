import { MarkdownView, TFile, type App, parseYaml } from "obsidian";
import invariant from "src/utils/invariant";
import {
	fileExistsAppendToBottom,
	fileExistsAppendToTop,
	fileExistsChoices,
	fileExistsDoNothing,
	fileExistsIncrement,
	fileExistsOverwriteFile,
	VALUE_SYNTAX,
} from "../constants";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import {
	normalizeTemplateInsertionConfig,
	type TemplateInsertionConfig,
	type TemplateInsertionPlacement,
} from "../types/choices/ITemplateChoice";
import { normalizeAppendLinkOptions, type LinkPlacement } from "../types/linkPlacement";
import {
	appendToCurrentLine,
	getAllFolderPathsInVault,
	insertLinkWithPlacement,
	insertFileLinkToActiveView,
	insertOnNewLineAbove,
	insertOnNewLineBelow,
	jumpToNextTemplaterCursorIfPossible,
	openExistingFileTab,
	openFile,
	templaterParseTemplate,
} from "../utilityObsidian";
import { isCancellationError, reportError } from "../utils/errorUtils";
import { flattenChoices } from "../utils/choiceUtils";
import { findYamlFrontMatterRange } from "../utils/yamlContext";
import { TemplateEngine } from "./TemplateEngine";
import { MacroAbortError } from "../errors/MacroAbortError";
import { handleMacroAbort } from "../utils/macroAbortHandler";

export class TemplateChoiceEngine extends TemplateEngine {
	public choice: ITemplateChoice;
	private readonly choiceExecutor: IChoiceExecutor;
	private static readonly FRONTMATTER_REGEX =
		/^(\s*---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$))/;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ITemplateChoice,
		choiceExecutor: IChoiceExecutor,
	) {
		super(app, plugin, choiceExecutor);
		this.choiceExecutor = choiceExecutor;
		this.choice = choice;
	}

	public async run(): Promise<void> {
		try {
			const insertion = normalizeTemplateInsertionConfig(this.choice.insertion);
			if (insertion.enabled) {
				await this.runInsertion(insertion);
				return;
			}

			invariant(this.choice.templatePath, () => {
				return `Invalid template path for ${this.choice.name}. ${this.choice.templatePath.length === 0
						? "Template path is empty."
						: `Template path is not valid: ${this.choice.templatePath}`
					}`;
			});

			const linkOptions = normalizeAppendLinkOptions(this.choice.appendLink);
			this.setLinkToCurrentFileBehavior(
				linkOptions.enabled && !linkOptions.requireActiveFile
					? "optional"
					: "required",
			);

			let folderPath = "";

			if (this.choice.folder.enabled) {
			folderPath = await this.getFolderPath();
			} else {
			// Respect Obsidian's "Default location for new notes" setting
			const parent = this.app.fileManager.getNewFileParent(
				this.app.workspace.getActiveFile()?.path ?? ""
			);
			folderPath = parent === this.app.vault.getRoot() ? "" : parent.path;
		}

			const format = this.choice.fileNameFormat.enabled
				? this.choice.fileNameFormat.format
				: VALUE_SYNTAX;
			const formattedName = await this.formatter.formatFileName(
				format,
				this.choice.name,
			);
			

			let filePath = this.normalizeTemplateFilePath(
				folderPath,
				formattedName,
				this.choice.templatePath,
			);

			if (this.choice.fileExistsMode === fileExistsIncrement)
				filePath = await this.incrementFileName(filePath);

			let createdFile: TFile | null;
			let shouldAutoOpen = false;
			if (await this.app.vault.adapter.exists(filePath)) {
				const file = this.findExistingFile(filePath);
				if (
					!(file instanceof TFile) ||
					(file.extension !== "md" && file.extension !== "canvas")
				) {
					log.logError(
						`'${filePath}' already exists but could not be resolved as a markdown or canvas file.`,
					);
					return;
				}

				let userChoice: (typeof fileExistsChoices)[number] =
					this.choice.fileExistsMode;

				if (!this.choice.setFileExistsBehavior) {
					try {
						userChoice = await GenericSuggester.Suggest(
							this.app,
							[...fileExistsChoices],
							[...fileExistsChoices],
						);
					} catch (error) {
						if (isCancellationError(error)) {
							throw new MacroAbortError("Input cancelled by user");
						}
						throw error;
					}
				}

				switch (userChoice) {
					case fileExistsAppendToTop:
						createdFile = await this.appendToFileWithTemplate(
							file,
							this.choice.templatePath,
							"top",
						);
						break;
					case fileExistsAppendToBottom:
						createdFile = await this.appendToFileWithTemplate(
							file,
							this.choice.templatePath,
							"bottom",
						);
						break;
					case fileExistsOverwriteFile:
						createdFile = await this.overwriteFileWithTemplate(
							file,
							this.choice.templatePath,
						);
						break;
					case fileExistsDoNothing:
						createdFile = file;
						shouldAutoOpen = true; // Auto-open existing file when user chooses "Nothing"
						log.logMessage(`Opening existing file: ${file.path}`);
						break;
					case fileExistsIncrement: {
						const incrementFileName = await this.incrementFileName(filePath);
						createdFile = await this.createFileWithTemplate(
							incrementFileName,
							this.choice.templatePath,
						);
						break;
					}
					default:
						log.logWarning("File not written to.");
						return;
				}
			} else {
				createdFile = await this.createFileWithTemplate(
					filePath,
					this.choice.templatePath,
				);
				if (!createdFile) {
					log.logWarning(`Could not create file '${filePath}'.`);
					return;
				}
			}

			if (linkOptions.enabled && createdFile) {
			insertFileLinkToActiveView(this.app, createdFile, linkOptions);
			}

			if ((this.choice.openFile || shouldAutoOpen) && createdFile) {
				const focus = this.choice.fileOpening.focus ?? true;
				const openExistingTab = openExistingFileTab(
					this.app,
					createdFile,
					focus,
				);

				if (!openExistingTab) {
					await openFile(this.app, createdFile, this.choice.fileOpening);
				}

				await jumpToNextTemplaterCursorIfPossible(this.app, createdFile);
			}
		} catch (err) {
			if (
				handleMacroAbort(err, {
					logPrefix: "Template execution aborted",
					noticePrefix: "Template execution aborted",
					defaultReason: "Template execution aborted",
				})
			) {
				this.choiceExecutor.signalAbort?.(err as MacroAbortError);
				return;
			}
			reportError(err, `Error running template choice "${this.choice.name}"`);
		}
	}

	private async runInsertion(insertion: TemplateInsertionConfig): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			throw new MacroAbortError("No active file to insert into.");
		}
		if (activeFile.extension !== "md") {
			throw new MacroAbortError("Active file is not a Markdown note.");
		}

		const templatePath = await this.resolveInsertionTemplatePath(insertion);
		invariant(templatePath, () => {
			return `Invalid template path for ${this.choice.name}. ${
				templatePath?.length === 0 ? "Template path is empty." : ""
			}`;
		});

		const { content: formattedTemplate, templateVars } =
			await this.formatTemplateForFile(templatePath, activeFile);
		const templaterContent = await templaterParseTemplate(
			this.app,
			formattedTemplate,
			activeFile,
		);

		const { frontmatter, body } = this.splitFrontmatter(templaterContent);
		const hasBody = body.trim().length > 0;

		if (frontmatter) {
			await this.applyFrontmatterProperties(activeFile, frontmatter);
		}

		if (insertion.placement === "top" || insertion.placement === "bottom") {
			const fileContent = await this.app.vault.read(activeFile);
			const nextContent = hasBody
				? insertion.placement === "top"
					? this.insertBodyAtTop(fileContent, body)
					: this.insertBodyAtBottom(fileContent, body)
				: fileContent;
			if (nextContent !== fileContent) {
				await this.app.vault.modify(activeFile, nextContent);
			}
		} else if (hasBody) {
			this.insertBodyIntoEditor(body, insertion.placement);
		}

		if (this.shouldPostProcessFrontMatter(activeFile, templateVars)) {
			await this.postProcessFrontMatter(activeFile, templateVars);
		}
	}

	private async resolveInsertionTemplatePath(
		insertion: TemplateInsertionConfig,
	): Promise<string> {
		switch (insertion.templateSource.type) {
			case "prompt":
				return await this.promptForTemplatePath();
			case "choice":
				return await this.resolveTemplatePathFromChoice(
					insertion.templateSource.value,
				);
			case "path":
			default:
				return insertion.templateSource.value ?? this.choice.templatePath;
		}
	}

	private async promptForTemplatePath(): Promise<string> {
		const templates = this.plugin.getTemplateFiles().map((file) => file.path);
		try {
			return await InputSuggester.Suggest(this.app, templates, templates, {
				placeholder: "Template path",
			});
		} catch (error) {
			if (isCancellationError(error)) {
				throw new MacroAbortError("Input cancelled by user");
			}
			throw error;
		}
	}

	private async resolveTemplatePathFromChoice(
		choiceIdOrName?: string,
	): Promise<string> {
		const templateChoices = flattenChoices(this.plugin.settings.choices).filter(
			(choice) => choice.type === "Template",
		) as ITemplateChoice[];

		invariant(
			templateChoices.length > 0,
			"No Template choices available to select from.",
		);

		let selectedChoice: ITemplateChoice | undefined;
		if (choiceIdOrName) {
			selectedChoice = templateChoices.find(
				(choice) =>
					choice.id === choiceIdOrName || choice.name === choiceIdOrName,
			);
		}

		if (!selectedChoice) {
			const displayItems = templateChoices.map((choice) =>
				choice.templatePath
					? `${choice.name} (${choice.templatePath})`
					: choice.name,
			);
			try {
				selectedChoice = await GenericSuggester.Suggest(
					this.app,
					displayItems,
					templateChoices,
					"Select Template choice",
				);
			} catch (error) {
				if (isCancellationError(error)) {
					throw new MacroAbortError("Input cancelled by user");
				}
				throw error;
			}
		}

		invariant(
			selectedChoice?.templatePath,
			`Template choice "${selectedChoice?.name ?? "Unknown"}" has no template path.`,
		);

		return selectedChoice.templatePath;
	}

	private splitFrontmatter(content: string): {
		frontmatter: string | null;
		body: string;
	} {
		const match = TemplateChoiceEngine.FRONTMATTER_REGEX.exec(content);
		if (!match) {
			return { frontmatter: null, body: content };
		}

		return {
			frontmatter: match[2],
			body: content.slice(match[0].length),
		};
	}

	private async applyFrontmatterProperties(
		file: TFile,
		frontmatter: string,
	): Promise<void> {
		const trimmed = frontmatter.trim();
		if (!trimmed) return;

		let parsed: unknown;
		try {
			parsed = parseYaml(trimmed);
		} catch (error) {
			log.logWarning(
				`Template insertion: failed to parse frontmatter for ${file.path}: ${String(
					error,
				)}`,
			);
			return;
		}

		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			log.logWarning(
				`Template insertion: frontmatter did not parse to an object for ${file.path}.`,
			);
			return;
		}

		try {
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
					fm[key] = value;
				}
			});
		} catch (error) {
			log.logWarning(
				`Template insertion: failed to apply frontmatter for ${file.path}: ${String(
					error,
				)}`,
			);
		}
	}

	private insertBodyAtTop(content: string, body: string): string {
		if (!body || body.trim().length === 0) {
			return content;
		}

		const yamlRange = findYamlFrontMatterRange(content);
		const insertIndex = yamlRange ? yamlRange[1] : 0;
		const prefix = content.slice(0, insertIndex);
		const suffix = content.slice(insertIndex);

		return this.joinWithNewlines(prefix, body, suffix);
	}

	private insertBodyAtBottom(content: string, body: string): string {
		if (!body || body.trim().length === 0) {
			return content;
		}

		return this.joinWithNewlines(content, body, "");
	}

	private insertBodyIntoEditor(
		body: string,
		placement: TemplateInsertionPlacement,
	): void {
		if (!body || body.trim().length === 0) {
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			throw new MacroAbortError("No active Markdown view.");
		}

		switch (placement) {
			case "currentLine":
				appendToCurrentLine(body, this.app);
				break;
			case "newLineAbove":
				insertOnNewLineAbove(body, this.app);
				break;
			case "newLineBelow":
				insertOnNewLineBelow(body, this.app);
				break;
			case "replaceSelection":
			case "afterSelection":
			case "endOfLine":
				insertLinkWithPlacement(this.app, body, placement as LinkPlacement);
				break;
			default:
				throw new Error(`Unknown insertion placement: ${placement}`);
		}
	}

	private joinWithNewlines(prefix: string, insert: string, suffix: string): string {
		if (!insert || insert.length === 0) {
			return `${prefix}${suffix}`;
		}

		let output = prefix;
		if (output && !output.endsWith("\n") && !insert.startsWith("\n")) {
			output += "\n";
		}

		output += insert;

		if (suffix && !output.endsWith("\n") && !suffix.startsWith("\n")) {
			output += "\n";
		}

		output += suffix;
		return output;
	}

	/**
	 * Resolve an existing file by path with a case-insensitive fallback.
	 *
	 * Obsidian's in-memory file index is case-sensitive, but on
	 * case-insensitive filesystems adapter.exists can still return true.
	 * If a direct lookup fails, scan the vault for a single case-insensitive
	 * match. Multiple matches are treated as ambiguous and return null.
	 */
	private findExistingFile(filePath: string): TFile | null {
		const direct = this.app.vault.getAbstractFileByPath(filePath);
		if (direct instanceof TFile) return direct;
		if (direct) return null;

		// On case-insensitive filesystems, adapter.exists can return true even when
		// Obsidian's case-sensitive path index can't resolve the file.
		const lowerPath = filePath.toLowerCase();
		const matches = this.app.vault
			.getFiles()
			.filter((file) => file.path.toLowerCase() === lowerPath);

		if (matches.length === 1) return matches[0];
		if (matches.length > 1) {
			const matchList = matches.map((match) => match.path).join(", ");
			log.logError(
				`Multiple files match '${filePath}' when ignoring case: ${matchList}`,
			);
		}

		return null;
	}

	private async formatFolderPaths(folders: string[]) {
		const folderPaths = await Promise.all(
			folders.map(async (folder) => {
				return await this.formatter.formatFolderPath(folder);
			}),
		);

		return folderPaths;
	}

	private async getFolderPath() {
		const folders: string[] = await this.formatFolderPaths([
			...this.choice.folder.folders,
		]);
		const currentFolder = this.getCurrentFolderSuggestion();
		const topItems = currentFolder ? [currentFolder] : [];

		if (
			this.choice.folder?.chooseFromSubfolders &&
			!(
				this.choice.folder?.chooseWhenCreatingNote ||
				this.choice.folder?.createInSameFolderAsActiveFile
			)
		) {
			const allFoldersInVault: string[] = getAllFolderPathsInVault(this.app);

			const subfolders = allFoldersInVault.filter((folder) => {
				return folders.some((f) => folder.startsWith(f));
			});

			return await this.getOrCreateFolder(subfolders, {
				allowCreate: true,
				allowedRoots: folders,
				topItems,
			});
		}

		if (this.choice.folder?.chooseWhenCreatingNote) {
			const allFoldersInVault: string[] = getAllFolderPathsInVault(this.app);
			return await this.getOrCreateFolder(allFoldersInVault, {
				allowCreate: true,
				topItems,
			});
		}

		if (this.choice.folder?.createInSameFolderAsActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();

			if (!activeFile || !activeFile.parent) {
				log.logWarning(
					"No active file or active file has no parent. Cannot create file in same folder as active file. Creating in root folder.",
				);
				return "";
			}

			return await this.getOrCreateFolder([activeFile.parent.path], {
				allowCreate: true,
				topItems,
			});
		}

		return await this.getOrCreateFolder(folders, {
			allowCreate: true,
			allowedRoots: folders,
			topItems,
		});
	}

	private getCurrentFolderSuggestion():
		| { path: string; label: string }
		| null {
		const activeFile = this.app.workspace.getActiveFile();
		const parent = activeFile?.parent;
		if (!activeFile || !parent) return null;
		const path = parent.path ?? "";
		return {
			path,
			label: "<current folder>",
		};
	}
}
