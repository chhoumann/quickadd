import { appendLinkDestinationError, insertChoiceFileLink, copyChoiceFileLink, openChoiceFile } from "./choiceFileActions";
import type { App, WorkspaceLeaf } from "obsidian";
import { Notice, TFile } from "obsidian";
import invariant from "src/utils/invariant";
import { VALUE_SYNTAX } from "../constants";
import { isMarkdownTemplatePath } from "./applyTemplateToActiveNote";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
import {
	getFileExistsMode,
	getExistingNoteAction,
	type TemplateExistingNoteAction,
	getPromptModes,
	resolveCreateNewCollisionFilePath,
	type FileExistsModeId,
} from "../template/fileExistsPolicy";
import { promptForTemplateNoteDiscovery } from "./promptForTemplateNoteDiscovery";
import { resolveTemplateNoteSelection } from "src/utils/templateNoteDiscovery";
import { shouldRunTemplateNoteDiscovery } from "src/utils/templateNoteDiscoveryEligibility";
import { getPreparedTemplateNoteSelection } from "src/preflight/preparedChoiceInputs";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { ChoiceEffect } from "../types/ChoiceOutcome";
import { routePrompt } from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";
import {
	normalizeAppendLinkOptions,
} from "../types/linkPlacement";
import { getAllFolderPathsInVault } from "../utils/vaultQueries";
import { jumpToNextTemplaterCursorIfPossible } from "../utils/templaterIntegration";
import { getMarkdownEditorViewForFile } from "../utils/editorInsertion";
import { currentFile } from "../utils/currentFile";
import { reportError } from "../utils/errorUtils";
import {
	ChoiceOutcomeRecorder,
	failureReason,
} from "./choiceOutcomeRecorder";
import {
	orderFolderPathsByConfiguredRoots,
	sortFolderPathsByTree,
} from "../utils/folder-sorting";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { TemplateEngine } from "./TemplateEngine";
import { TemplateInsertEngine } from "./TemplateInsertEngine";
import type { ChoiceChain } from "./choiceChain";
import { MacroAbortError } from "../errors/MacroAbortError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { handleMacroAbort } from "../utils/macroAbortHandler";
import { parentFolderPath } from "../utils/pathUtils";
import { mapEditorCursorPlacement } from "../utils/editorCursorPlacement";
import { getTemplateFile } from "../utils/templateFolderUtils";
import { deriveFolderMode, type FolderMode } from "../utils/folderMode";
import { canonicalFolderPath, chooseFolder } from "./folderSelection";

type NormalizedAppendLinkOptions = ReturnType<typeof normalizeAppendLinkOptions>;

export class TemplateChoiceEngine extends TemplateEngine {
	public choice: ITemplateChoice;
	private readonly choiceExecutor: IChoiceExecutor;
	private readonly outcome: ChoiceOutcomeRecorder;

	constructor(
		app: App,
		plugin: ChoiceRuntimePlugin,
		runtime: FormatterExecutionRuntime,
		choice: ITemplateChoice,
		choiceExecutor: IChoiceExecutor,
		private readonly originLeaf: WorkspaceLeaf | null = null,
		private readonly chain: ChoiceChain = [choice],
	) {
		super(app, plugin, runtime, choiceExecutor);
		this.choiceExecutor = choiceExecutor;
		this.outcome = new ChoiceOutcomeRecorder(choiceExecutor);
		this.choice = choice;
		this.formatter.setPromptRunContext({
			draftScopeId: choice.id,
			choiceName: choice.name,
		});
		this.formatter.choiceChain = chain;
	}

	public async run(): Promise<void> {
		this.cursorPlacement = null;
		let restoreDiscoveryValue: (() => void) | null = null;
		let discoveryVaultRelativePath: string | null = null;
		let selectedUpdate: { file: TFile; mode: Exclude<TemplateExistingNoteAction, "open"> } | null = null;

		try {
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

			const format = this.choice.fileNameFormat.enabled
				? this.choice.fileNameFormat.format
				: VALUE_SYNTAX;

			if (
				shouldRunTemplateNoteDiscovery(
					this.choice,
					format,
					this.choiceExecutor.variables.get("value"),
				)
			) {
				const prepared = getPreparedTemplateNoteSelection(this.choiceExecutor, this.choice.id);
				const discovery = prepared
					? resolveTemplateNoteSelection(this.app, prepared)
					: await promptForTemplateNoteDiscovery(
						this.app,
						this.choice,
						this.choiceExecutor,
					);
				if (discovery.kind === "existing") {
					const action = getExistingNoteAction(this.choice.existingNoteAction);
					if (action === "open") {
						await this.openDiscoveredExistingNote(discovery.file);
						this.outcome.success(discovery.file, "unchanged");
						return;
					}
					selectedUpdate = { file: discovery.file, mode: action };
					restoreDiscoveryValue = this.setTemporaryValueVariable(discovery.file.basename);
				} else {
					restoreDiscoveryValue = this.setTemporaryValueVariable(discovery.title);
					discoveryVaultRelativePath = discovery.vaultRelativePath ?? null;
				}
				await this.choiceExecutor.resolveDateOrigin?.(this.choice);
			}

			const linkDestinationError = appendLinkDestinationError(this.app, linkOptions);
			if (linkDestinationError) {
				this.outcome.fail(linkDestinationError);
				return;
			}

			// Open-only discovery returns before evaluating the template source.
			const templatePath = await this.resolveTemplateSourcePath(
				this.choice.templatePath,
			);
			if (selectedUpdate && getTemplateFile(this.app, templatePath)?.path === selectedUpdate.file.path) {
				throw new ChoiceAbortError("Cannot apply a template to its own template source.");
			}

			const targetFilePath = selectedUpdate?.file.path ?? await this.resolveNewNotePath({
				templatePath, format, discoveryVaultRelativePath,
			});

			let createdFile: TFile | null;
			let shouldAutoOpen = false;
			let createdNew = false;
			// What this run did to its target note, from the file-exists resolution
			// actually performed. Only "modifyExisting" is inferred: it always writes,
			// so `changed` can over-report identical bytes, the harmless direction.
			let effect: ChoiceEffect = "created";
			if (selectedUpdate) {
				if (!isMarkdownTemplatePath(templatePath)) {
					throw new ChoiceAbortError("Only Markdown templates can be applied to a selected note.");
				}
				createdFile = await this.applyExistingFileUpdate(
					selectedUpdate.mode, selectedUpdate.file, templatePath, linkOptions,
				);
				if (!createdFile) {
					this.outcome.fail(this.lastTemplateFileFailure ?? `Could not apply template to '${targetFilePath}'.`, "none");
					return;
				}
				effect = "changed";
			} else if (await this.app.vault.adapter.exists(targetFilePath)) {
				const modeId = await this.getSelectedFileExistsMode();
				const mode = getFileExistsMode(modeId);
				effect =
					mode.resolutionKind === "reuseExisting"
						? "unchanged"
						: mode.resolutionKind === "createNew"
							? "created"
							: "changed";
				const existingFile = mode.requiresExistingFile
					? this.findExistingFile(targetFilePath)
					: null;

				if (
					mode.requiresExistingFile &&
					(!(existingFile instanceof TFile) ||
						(existingFile.extension !== "md" &&
							existingFile.extension !== "canvas" &&
							existingFile.extension !== "base"))
				) {
					this.outcome.fail(
						`'${targetFilePath}' already exists but could not be resolved as a markdown, canvas, or base file.`,
					);
					return;
				}

				({ createdFile, shouldAutoOpen } = await this.applyFileExistsMode(
					modeId,
					targetFilePath,
					existingFile,
					templatePath,
					linkOptions,
				));
				if (!createdFile) {
					// applyFileExistsMode's write helper has already reported the real
					// cause (whichever mode ran - create, overwrite or append); prefer it
					// and do not log a vaguer second line for the same failure.
					if (this.lastTemplateFileFailure) {
						this.outcome.fail(this.lastTemplateFileFailure, "none");
					} else {
						this.outcome.fail(
							`Could not resolve file exists behavior for '${targetFilePath}'.`,
							"warning",
						);
					}
					return;
				}
			} else {
				createdFile = await this.createFileWithTemplate(
					targetFilePath,
					templatePath,
				);
				if (!createdFile) {
					// No second log line: createFileWithTemplate already reported the
					// cause. Record it as the outcome for callers who cannot see notices.
					this.outcome.fail(
						this.lastTemplateFileFailure ??
							`Could not create file '${targetFilePath}'.`,
						"none",
					);
					return;
				}
				createdNew = true;
			}

			// File is created/resolved (the commit point). Record success before
			// append-link/open-file steps so a later post-commit failure cannot make
			// automation callers retry and duplicate the Template side effect.
			this.outcome.success(createdFile, effect);
			const cursorBeforeLink = this.cursorPlacement;

			if (linkOptions.enabled && createdFile) {
				// The note is already committed (success recorded above). A link
				// failure here — most commonly strict "Link to created file" with no
				// active Markdown view — must not surface as "Error running template
				// choice", which implies the run failed and tempts a duplicate re-run.
				// Report it as a non-fatal warning that names the created file.
				try {
					await insertChoiceFileLink(this.app, createdFile, linkOptions,
						this.choiceExecutor, this.cursorPlacement ? mutation => {
							if (this.cursorPlacement && mutation.filePath === createdFile?.path) {
								this.cursorPlacement = mapEditorCursorPlacement(this.cursorPlacement, mutation);
							}
						} : undefined);
				} catch (linkError) {
					// An abort propagating through the link step still aborts the run.
					if (linkError instanceof MacroAbortError) {
						throw linkError;
					}
					log.logWarning(
						`Created '${createdFile.basename}' but could not insert the link: ${
							linkError instanceof Error
								? linkError.message
								: String(linkError)
						}`,
					);
				}
			}

			if (this.choice.copyLinkToClipboard && createdFile) {
				await copyChoiceFileLink(createdFile);
			}

			if ((this.choice.openFile || shouldAutoOpen) && createdFile) {
				await openChoiceFile({
					app: this.app, file: createdFile,
					opening: this.choice.fileOpening, originLeaf: this.originLeaf,
				});

				if (!this.templaterCursorHandled && !await jumpToNextTemplaterCursorIfPossible(this.app, createdFile)) {
					this.placeCursor(createdFile, cursorBeforeLink);
				}
			} else if (this.cursorPlacement && getMarkdownEditorViewForFile(this.app, createdFile)) {
				if (!this.templaterCursorHandled && !await jumpToNextTemplaterCursorIfPossible(this.app, createdFile)) {
					this.placeCursor(createdFile, cursorBeforeLink);
				}
			} else if (
				(createdNew || effect === "unchanged") &&
				!linkOptions.enabled &&
				!this.choice.copyLinkToClipboard
			) {
				// Nothing else surfaces the note (not opened, no link appended, not
				// copied to clipboard). Say what happened so the run isn't silent -
				// mirroring Capture's success notice.
				new Notice(
					createdNew
						? `Created '${createdFile.basename}'.`
						: `'${createdFile.basename}' already exists.`,
				);
			}
		} catch (err) {
			if (
				handleMacroAbort(err, {
					logPrefix: "Template execution aborted",
					noticePrefix: "Template execution aborted",
					defaultReason: "Template execution aborted",
				})
			) {
				this.choiceExecutor.signalAbort?.(err);
				return;
			}
			InputPromptDraftStore.getInstance().markExecutionScopeFailed();
			// Record before reporting so the notice and the caller's reason agree.
			this.outcome.failure(failureReason(err));
			reportError(err, `Error running template choice "${this.choice.name}"`);
		} finally {
			restoreDiscoveryValue?.();
		}
	}

	private async resolveNewNotePath({ templatePath, format, discoveryVaultRelativePath }: {
		templatePath: string;
		format: string;
		discoveryVaultRelativePath: string | null;
	}): Promise<string> {
		const folderMode = deriveFolderMode(this.choice.folder);
		let folderPath = "";

		if (discoveryVaultRelativePath) {
			folderPath = parentFolderPath(discoveryVaultRelativePath);
		} else if (folderMode === "obsidian-default") {
			// Respect Obsidian's "Default location for new notes" setting
			const parent = this.app.fileManager.getNewFileParent(
				currentFile(this.app, this.choiceExecutor)?.path ?? "",
			);
			folderPath = parent === this.app.vault.getRoot() ? "" : parent.path;
		} else {
			folderPath = await this.getFolderPath(folderMode);
		}

		// Make the resolved folder available to {{FOLDER}} in the file name.
		this.formatter.setTargetFolderPath(folderPath);
		// The title prompt below can say where the note will be created only
		// when a folder is actually configured. With folder settings off the
		// formatted name can reroute the note from the vault root
		// (shouldTreatFormattedNameAsVaultRelativePath returns false as soon
		// as folderEnabled), and the answer that reroutes it is the very one
		// being typed - so Obsidian's default location is not something this
		// prompt can promise.
		if (folderMode !== "obsidian-default") {
			this.formatter.setPromptRunContext({
				destination: folderPath,
				destinationKind: "folder",
			});
		}

		const formattedName = discoveryVaultRelativePath
			? discoveryVaultRelativePath
			: await this.formatter.formatFileName(format, "noteTitle");
		const routedName = normalizeGeneratedFilePath(formattedName, "File name");
		const { fileName, strippedPrefix } = discoveryVaultRelativePath
			? { fileName: routedName, strippedPrefix: false }
			: this.stripDuplicateFolderPrefix(
				routedName,
				folderPath,
			);
		const treatAsVaultRelativePath =
			this.shouldTreatFormattedNameAsVaultRelativePath(
				routedName,
				strippedPrefix,
				folderMode !== "obsidian-default",
			);

		return this.normalizeTemplateFilePath(
			discoveryVaultRelativePath || treatAsVaultRelativePath ? "" : folderPath,
			fileName,
			templatePath,
		);
	}

	private setTemporaryValueVariable(value: string): () => void {
		const variables = this.choiceExecutor.variables;
		const hadPreviousValue = variables.has("value");
		const previousValue = variables.get("value");

		variables.set("value", value);

		return () => {
			if (hadPreviousValue) {
				variables.set("value", previousValue);
				return;
			}
			variables.delete("value");
		};
	}

	private async getSelectedFileExistsMode(): Promise<FileExistsModeId> {
		this.choice.fileExistsBehavior ??= { kind: "prompt" };

		if (this.choice.fileExistsBehavior.kind === "apply") {
			return this.choice.fileExistsBehavior.mode;
		}

		const promptModes = getPromptModes();
		const placeholder = "If the target file already exists";

		return (await routePrompt(this.choiceExecutor, {
			remote: (provider) =>
				promptEngineChoice(provider, {
					items: promptModes.map((mode) => ({
						value: mode.id,
						title: mode.label,
					})),
					placeholder,
					what: 'the "file already exists" chooser',
				}),
			// Non-interactive run: nobody can answer. This is the default for new
			// Template choices, so it is the most common non-interactive hang.
			headless: () => {
				throw new ChoiceAbortError(
					`'${this.choice.name}' needs to ask what to do because a note with that name already exists, but this run is non-interactive. ` +
						`Set the choice's "If the file already exists" behaviour to a specific action (e.g. Increment, Overwrite), or re-run with the ui flag.`,
				);
			},
			app: () =>
				GenericSuggester.Suggest(
					this.app,
					promptModes.map((mode) => mode.label),
					promptModes.map((mode) => mode.id),
					placeholder,
				),
		})) as FileExistsModeId;
	}

	private async applyFileExistsMode(
		modeId: FileExistsModeId,
		targetFilePath: string,
		existingFile: TFile | null,
		templatePath: string,
		linkOptions: NormalizedAppendLinkOptions,
	): Promise<{ createdFile: TFile | null; shouldAutoOpen: boolean }> {
		const mode = getFileExistsMode(modeId);

		switch (mode.resolutionKind) {
			case "modifyExisting":
				return {
					createdFile: await this.applyExistingFileUpdate(
						mode.id,
						existingFile!,
						templatePath,
						linkOptions,
					),
					shouldAutoOpen: false,
				};
			case "createNew": {
				const nextFilePath = await resolveCreateNewCollisionFilePath(
					targetFilePath,
					mode.id,
					async (path) => await this.app.vault.adapter.exists(path),
				);

				const createdFile = await this.createFileWithTemplate(
					nextFilePath,
					templatePath,
				);

				// A collision forced a different name. If the file won't be opened,
				// the user otherwise gets no signal which name was actually used and
				// may re-run, accumulating "Plan (1)", "Plan (2)", … clutter.
				if (
					createdFile &&
					nextFilePath !== targetFilePath &&
					!this.choice.openFile
				) {
					new Notice(`Created '${createdFile.basename}'.`);
				}

				return {
					createdFile,
					shouldAutoOpen: false,
				};
			}
			case "reuseExisting":
				return {
					createdFile: existingFile,
					shouldAutoOpen: mode.opensExistingFile,
				};
		}
	}

	private async openDiscoveredExistingNote(file: TFile): Promise<void> {
		await openChoiceFile({
			app: this.app, file, opening: this.choice.fileOpening,
			originLeaf: this.originLeaf, forceFocus: true,
		});
	}

	private async applyExistingFileUpdate(
		modeId: "appendTop" | "appendBottom" | "overwrite",
		existingFile: TFile,
		templatePath: string,
		linkOptions: NormalizedAppendLinkOptions,
	): Promise<TFile | null> {
		return modeId === "overwrite"
			? this.overwriteFileWithTemplate(existingFile, templatePath)
			: this.appendToExistingFileWithTemplate(existingFile, templatePath,
				modeId === "appendTop" ? "top" : "bottom", linkOptions);
	}

	private async appendToExistingFileWithTemplate(
		existingFile: TFile,
		resolvedTemplatePath: string,
		position: "top" | "bottom",
		linkOptions: NormalizedAppendLinkOptions,
	): Promise<TFile | null> {
		if (
			existingFile.extension === "canvas" ||
			existingFile.extension === "base"
		) {
			// Appending raw text to canvas/base JSON would corrupt it; only Overwrite
			// is safe. Recorded so a caller who cannot see notices gets this
			// actionable sentence.
			this.lastTemplateFileFailure = `Cannot append to '${existingFile.path}': appending a template to a ${existingFile.extension} file would corrupt it. Use the "Overwrite" file-exists option instead.`;
			InputPromptDraftStore.getInstance().markExecutionScopeFailed();
			log.logError(this.lastTemplateFileFailure);
			return null;
		}

		const insertEngine = new TemplateInsertEngine(
			this.app,
			this.plugin,
			this.runtime,
			existingFile,
			resolvedTemplatePath,
			position,
			this.choiceExecutor,
			resolvedTemplatePath,
		);
		// This engine owns its own formatter, so hand over the run context or every
		// prompt raised while appending loses the choice name, destination and
		// draft scope.
		insertEngine.setPromptRunContext({
			draftScopeId: this.choice.id,
			choiceName: this.choice.name,
			destination: existingFile.path,
			destinationKind: "file",
		});
		insertEngine.choiceChain = this.chain;
		insertEngine.setLinkToCurrentFileBehavior(
			linkOptions.enabled && !linkOptions.requireActiveFile
				? "optional"
				: "required",
		);

		const file = await this.withAnonymousValueForInsertEngine(() =>
			insertEngine.apply()
		);
		this.cursorPlacement = insertEngine.getCursorPlacement();
		return file;
	}

	private async withAnonymousValueForInsertEngine<T>(
		work: () => Promise<T>,
	): Promise<T> {
		const anonymousValue = this.formatter.getAnonymousValue();
		const variables = this.choiceExecutor.variables;
		const shouldSeedValue =
			anonymousValue !== undefined && !variables.has("value");

		if (!shouldSeedValue) {
			return await work();
		}

		const restore = this.setTemporaryValueVariable(anonymousValue);
		try {
			return await work();
		} finally {
			restore();
		}
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

	// Sequential, not Promise.all: these passes share one formatter, and
	// overlapping passes interleave its per-pass prompt scope (and would stack
	// several prompt modals at once if a folder definition contained {{VALUE}}).
	private async formatFolderPaths(folders: string[]) {
		const folderPaths: string[] = [];
		for (const folder of folders) {
			folderPaths.push(await this.formatter.formatFolderPath(folder));
		}

		return folderPaths;
	}

	/** The folder a configured mode resolves to; the mode comes from deriveFolderMode. */
	private async getFolderPath(mode: Exclude<FolderMode, "obsidian-default">) {
		const config = this.choice.folder;
		const currentFolder = currentFile(this.app, this.choiceExecutor)?.parent?.path;
		const choose = (destinations: string[], allowedRoots?: string[]) =>
			chooseFolder(this.app, destinations, {
				allowCreate: true, allowedRoots, currentFolder, executor: this.choiceExecutor,
			});

		switch (mode) {
			// The picker offers the vault's folders, so configured folders are not
			// formatted at all: a token in an unused folder must not prompt or fail.
			case "prompt":
				return choose(sortFolderPathsByTree(getAllFolderPathsInVault(this.app)));
			case "active-file":
				if (currentFolder === undefined) {
					log.logWarning(
						"No active file or active file has no parent. Cannot create file in same folder as active file. Creating in root folder.",
					);
					return "";
				}
				return choose([currentFolder]);
			case "specified": {
				// Configured folders are matched against vault paths below (subfolder
				// ordering, allowed roots), so they are canonicalized before any of
				// that, not only when a selection is resolved.
				const folders = (await this.formatFolderPaths([...config.folders])).map(canonicalFolderPath);
				// Configured root order wins; descendants are tree-sorted within each root.
				const destinations = config.chooseFromSubfolders
					? orderFolderPathsByConfiguredRoots(sortFolderPathsByTree(getAllFolderPathsInVault(this.app)), folders)
					: folders;
				return choose(destinations, folders);
			}
		}
	}
}
