import type { App, WorkspaceLeaf } from "obsidian";
import { Notice, TFile } from "obsidian";
import invariant from "src/utils/invariant";
import { VALUE_SYNTAX } from "../constants";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import {
	getFileExistsMode,
	getPromptModes,
	resolveCreateNewCollisionFilePath,
	type FileExistsModeId,
} from "../template/fileExistsPolicy";
import {
	promptForTemplateNoteDiscovery,
	shouldRunTemplateNoteDiscovery,
} from "./templateNoteDiscovery";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { ChoiceEffect } from "../types/ChoiceOutcome";
import { routePrompt } from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";
import {
	normalizeAppendLinkOptions,
	placementSupportsFrontmatter,
} from "../types/linkPlacement";
import {
	getAllFolderPathsInVault,
	insertFileLinkToActiveView,
	jumpToNextTemplaterCursorIfPossible,
	openExistingFileTab,
	openFile,
} from "../utilityObsidian";
import { reportError } from "../utils/errorUtils";
import {
	ChoiceOutcomeRecorder,
	failureReason,
} from "./choiceOutcomeRecorder";
import {
	filterFolderPathsWithinRoots,
	sortFolderPathsByTree,
} from "../utils/folder-sorting";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";
import {
	appendFileLinkToDestinationFile,
	copyFileLinkToClipboard,
	getAppendLinkDestinationFile,
} from "../utils/fileLinks";
import { appendLinkToFrontmatterProperty } from "../utils/frontmatterPropertyLinks";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { TemplateEngine } from "./TemplateEngine";
import { TemplateInsertEngine } from "./TemplateInsertEngine";
import { MacroAbortError } from "../errors/MacroAbortError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { handleMacroAbort } from "../utils/macroAbortHandler";
import { parentFolderPath } from "../utils/pathUtils";

type NormalizedAppendLinkOptions = ReturnType<typeof normalizeAppendLinkOptions>;

export class TemplateChoiceEngine extends TemplateEngine {
	public choice: ITemplateChoice;
	private readonly choiceExecutor: IChoiceExecutor;
	private readonly outcome: ChoiceOutcomeRecorder;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ITemplateChoice,
		choiceExecutor: IChoiceExecutor,
		private readonly originLeaf: WorkspaceLeaf | null = null,
	) {
		super(app, plugin, choiceExecutor);
		this.choiceExecutor = choiceExecutor;
		this.outcome = new ChoiceOutcomeRecorder(choiceExecutor);
		this.choice = choice;
		// Every prompt this run opens can say which choice is asking (issue #1546).
		this.formatter.setPromptRunContext({
			draftScopeId: choice.id,
			choiceName: choice.name,
		});
	}

	public async run(): Promise<void> {
		let restoreDiscoveryValue: (() => void) | null = null;
		let discoveryVaultRelativePath: string | null = null;

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
			if (!this.validateAppendLinkDestination(linkOptions)) return;

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
				const discovery = await promptForTemplateNoteDiscovery(
					this.app,
					this.choice,
					this.choiceExecutor,
				);
				if (discovery.kind === "openExisting") {
					await this.openDiscoveredExistingNote(discovery.file);
					// Opening a note is not writing one: this path exists precisely to
					// AVOID creating a duplicate, so it leaves the vault byte-identical
					// (#1615).
					this.outcome.success(discovery.file, "unchanged");
					return;
				}

				restoreDiscoveryValue = this.setTemporaryValueVariable(discovery.title);
				discoveryVaultRelativePath = discovery.vaultRelativePath ?? null;
			}

			// Resolve format tokens in the template path ONCE, after discovery has
			// either selected "create" or been skipped. Existing-note discovery exits
			// before any template-path prompt, folder creation, or template side effect.
			const templatePath = await this.resolveTemplateSourcePath(
				this.choice.templatePath,
			);

			let folderPath = "";

			if (discoveryVaultRelativePath) {
				folderPath = parentFolderPath(discoveryVaultRelativePath);
			} else if (this.choice.folder.enabled) {
				folderPath = await this.getFolderPath();
			} else {
				// Respect Obsidian's "Default location for new notes" setting
				const parent = this.app.fileManager.getNewFileParent(
					this.app.workspace.getActiveFile()?.path ?? "",
				);
				folderPath = parent === this.app.vault.getRoot() ? "" : parent.path;
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
			if (this.choice.folder.enabled) {
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
					this.choice.folder.enabled,
				);

			const targetFilePath = this.normalizeTemplateFilePath(
				discoveryVaultRelativePath || treatAsVaultRelativePath ? "" : folderPath,
				fileName,
				templatePath,
			);

			let createdFile: TFile | null;
			let shouldAutoOpen = false;
			let createdNew = false;
			// What this run did to its target note (#1615). Derived from the file-exists
			// resolution the engine actually performed rather than from a byte compare,
			// which is exact for the two answers an automation acts on: "createNew"
			// always writes a new note, and "reuseExisting" — the shipped "Do nothing"
			// mode — writes nothing at all. Only "modifyExisting" (append/overwrite) is
			// inferred: it always writes, so `changed` can in principle over-report a
			// write whose bytes happened to match, which is the harmless direction.
			let effect: ChoiceEffect = "created";
			if (await this.app.vault.adapter.exists(targetFilePath)) {
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
					this.failRun(
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
						this.failRun(this.lastTemplateFileFailure, "none");
					} else {
						this.failRun(
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
					// No second log line: createFileWithTemplate already reported the real
					// cause. Record that same cause as the outcome, so a caller who cannot
					// see notices is told what the notice said (#1603).
					this.failRun(
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

			if (linkOptions.enabled && createdFile) {
				// The note is already committed (success recorded above). A link
				// failure here — most commonly strict "Link to created file" with no
				// active Markdown view — must not surface as "Error running template
				// choice", which implies the run failed and tempts a duplicate re-run.
				// Report it as a non-fatal warning that names the created file.
				try {
					if (linkOptions.destination.type === "specifiedFile") {
						await appendFileLinkToDestinationFile(
							this.app,
							createdFile,
							linkOptions,
						);
					} else if (placementSupportsFrontmatter(linkOptions.placement)) {
						await insertFileLinkToActiveView(this.app, createdFile, linkOptions);
					} else if (this.choiceExecutor.focusedProperty) {
						await appendLinkToFrontmatterProperty(
							this.app,
							this.choiceExecutor.focusedProperty,
							createdFile,
						);
					} else {
						await insertFileLinkToActiveView(
							this.app,
							createdFile,
							linkOptions,
						);
					}
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
				try {
					await copyFileLinkToClipboard(createdFile);
				} catch (error) {
					log.logWarning(
						`Could not copy link to clipboard for '${createdFile.path}': ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
			}

			if ((this.choice.openFile || shouldAutoOpen) && createdFile) {
				const fileOpening = normalizeFileOpening(this.choice.fileOpening);
				const focus = fileOpening.focus ?? true;
				const openExistingTab = openExistingFileTab(
					this.app,
					createdFile,
					focus,
				);

				if (!openExistingTab) {
					await openFile(this.app, createdFile, {
						...fileOpening,
						originLeaf: this.originLeaf,
					});
				}

				await jumpToNextTemplaterCursorIfPossible(this.app, createdFile);
			} else if (
				createdNew &&
				!linkOptions.enabled &&
				!this.choice.copyLinkToClipboard
			) {
				// The note was created but nothing else surfaces it (not opened, no
				// link appended, not copied to clipboard). Confirm the creation so
				// the run isn't silent — mirroring Capture's success notice.
				new Notice(`Created '${createdFile.basename}'.`);
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
			// Record BEFORE reporting: the notice is for whoever is at the desktop, the
			// reason is for whoever is not (a CLI or interactive-bridge caller), and both
			// must say the same thing (#1603).
			this.outcome.failure(failureReason(err));
			reportError(err, `Error running template choice "${this.choice.name}"`);
		} finally {
			restoreDiscoveryValue?.();
		}
	}

	/**
	 * A failure exit that is not a throw: log it for the desktop, and record the same
	 * message as the run's outcome so a caller who cannot see notices learns the cause
	 * instead of the CLI's fixed "Choice execution failed" sentence (#1603).
	 */
	private failRun(
		message: string,
		level: "error" | "warning" | "none" = "error",
	): void {
		InputPromptDraftStore.getInstance().markExecutionScopeFailed();
		// "none" is for a failure a lower layer has ALREADY reported: logging again
		// would put a second notice on screen for one failure, which is exactly what
		// report-once removes elsewhere (#1601).
		if (level === "warning") log.logWarning(message);
		else if (level === "error") log.logError(message);
		this.outcome.failure(message);
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

		this.failRun(
			`Append link target file not found or is not a Markdown file: ${linkOptions.destination.path}`,
		);
		return false;
	}

	private async getSelectedFileExistsMode(): Promise<FileExistsModeId> {
		this.choice.fileExistsBehavior ??= { kind: "prompt" };

		if (this.choice.fileExistsBehavior.kind === "apply") {
			return this.choice.fileExistsBehavior.mode;
		}

		const promptModes = getPromptModes();
		const placeholder = "If the target file already exists";

		return (await routePrompt(this.choiceExecutor, {
			// An interactive run drives this from the client, like every other prompt
			// the run opens. Before, it opened on the desktop while the client's /poll
			// returned nothing, and the run waited for someone to walk past (#1614).
			remote: (provider) =>
				promptEngineChoice(provider, {
					items: promptModes.map((mode) => ({
						value: mode.id,
						title: mode.label,
					})),
					placeholder,
					what: 'the "file already exists" chooser',
				}),
			// Non-interactive run (CLI without `ui`): there is no one to answer, so
			// opening it would hang forever. Abort with an actionable error instead.
			// This is the default behaviour for new Template choices, so it is the most
			// common non-interactive hang.
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
				log.logMessage(`Opening existing file: ${existingFile!.path}`);
				return {
					createdFile: existingFile,
					shouldAutoOpen: true,
				};
		}
	}

	private async openDiscoveredExistingNote(file: TFile): Promise<void> {
		const fileOpening = normalizeFileOpening(this.choice.fileOpening);
		const openExistingTab = openExistingFileTab(this.app, file, true);

		if (!openExistingTab) {
			await openFile(this.app, file, {
				...fileOpening,
				focus: true,
				originLeaf: this.originLeaf,
			});
		}
	}

	private async applyExistingFileUpdate(
		modeId: "appendTop" | "appendBottom" | "overwrite",
		existingFile: TFile,
		templatePath: string,
		linkOptions: NormalizedAppendLinkOptions,
	): Promise<TFile | null> {
		switch (modeId) {
			case "appendTop":
				return await this.appendToExistingFileWithTemplate(
					existingFile,
					templatePath,
					"top",
					linkOptions,
				);
			case "appendBottom":
				return await this.appendToExistingFileWithTemplate(
					existingFile,
					templatePath,
					"bottom",
					linkOptions,
				);
			case "overwrite":
				return await this.overwriteFileWithTemplate(
					existingFile,
					templatePath,
				);
		}
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
			// Appending raw template text to a canvas/base file would splice it
			// into the file's structured JSON content and corrupt it. Only the
			// "Overwrite" file-exists option is safe for these formats.
			//
			// Recorded, not just logged: this is one of the report-and-return-null exits
			// whose caller owns the run's outcome, and it carries the most actionable
			// sentence of any of them (it names the fix). A CLI or interactive caller
			// would otherwise be told "Could not resolve file exists behavior" (#1603).
			this.lastTemplateFileFailure = `Cannot append to '${existingFile.path}': appending a template to a ${existingFile.extension} file would corrupt it. Use the "Overwrite" file-exists option instead.`;
			InputPromptDraftStore.getInstance().markExecutionScopeFailed();
			log.logError(this.lastTemplateFileFailure);
			return null;
		}

		if (existingFile.extension !== "md") {
			return await this.appendToFileWithTemplate(
				existingFile,
				resolvedTemplatePath,
				position,
			);
		}

		const insertEngine = new TemplateInsertEngine(
			this.app,
			this.plugin,
			existingFile,
			resolvedTemplatePath,
			position,
			this.choiceExecutor,
			resolvedTemplatePath,
		);
		// This engine owns its own formatter, so the run context has to be handed
		// over or every prompt raised while appending loses the choice name, the
		// destination and its draft scope (issue #1546).
		insertEngine.setPromptRunContext({
			draftScopeId: this.choice.id,
			choiceName: this.choice.name,
			destination: existingFile.path,
			destinationKind: "file",
		});
		insertEngine.setLinkToCurrentFileBehavior(
			linkOptions.enabled && !linkOptions.requireActiveFile
				? "optional"
				: "required",
		);

		return await this.withAnonymousValueForInsertEngine(() =>
			insertEngine.apply()
		);
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

		variables.set("value", anonymousValue);
		try {
			return await work();
		} finally {
			variables.delete("value");
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

	// The branch precedence below is mirrored by the choice builder's folder-mode
	// dropdown (gui/ChoiceBuilder/folderMode.ts → deriveFolderMode). If you change
	// the order or conditions here, update that helper (and its 16-combo test) so
	// the dropdown keeps showing the mode that actually runs.
	private async getFolderPath() {
		const folders: string[] = await this.formatFolderPaths([
			...this.choice.folder.folders,
		]);
		const currentFolder = this.getCurrentFolderSuggestion();
		const topItems = currentFolder ? [currentFolder] : [];
		// Where the folder chooser goes: the client on an interactive run, an abort on
		// a headless one, the modal otherwise. A single configured folder never prompts.
		const executor = this.choiceExecutor;

		if (
			this.choice.folder?.chooseFromSubfolders &&
			!(
				this.choice.folder?.chooseWhenCreatingNote ||
				this.choice.folder?.createInSameFolderAsActiveFile
			)
		) {
			const allFoldersInVault: string[] = sortFolderPathsByTree(
				getAllFolderPathsInVault(this.app),
			);

			const subfolders = filterFolderPathsWithinRoots(
				allFoldersInVault,
				folders,
			);

			return await this.getOrCreateFolder(subfolders, {
				allowCreate: true,
				allowedRoots: folders,
				topItems,
				executor,
			});
		}

		if (this.choice.folder?.chooseWhenCreatingNote) {
			const allFoldersInVault: string[] = sortFolderPathsByTree(
				getAllFolderPathsInVault(this.app),
			);
			return await this.getOrCreateFolder(allFoldersInVault, {
				allowCreate: true,
				topItems,
				executor,
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
				executor,
			});
		}

		return await this.getOrCreateFolder(folders, {
			allowCreate: true,
			allowedRoots: folders,
			topItems,
			executor,
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
