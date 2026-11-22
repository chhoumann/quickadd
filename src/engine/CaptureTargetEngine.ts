import { TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { CaptureChoiceFormatter } from "../formatters/captureChoiceFormatter";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { QuickAddEngine } from "./QuickAddEngine";
import { normalizeMarkdownFilePath, stripLeadingSlash } from "./vaultFiles";
import { BASE_FILE_EXTENSION_REGEX, CANVAS_FILE_EXTENSION_REGEX, MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { getMarkdownFilesInFolder, getMarkdownFilesMatchingFilter, getMarkdownFilesWithProperty, isFolder } from "../utils/vaultQueries";
import InputSuggester from "../gui/InputSuggester/inputSuggester";
import { renderNotePathSuggestion } from "../gui/InputSuggester/renderNotePathSuggestion";
import invariant from "../utils/invariant";
import { readPreselectedCaptureTarget } from "../preflight/captureTargetKey";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";
import { basenameWithoutMdOrCanvas } from "../utils/pathUtils";
import type { FieldFilter } from "../utils/FieldSuggestionParser";
import { routePrompt } from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { captureCandidates, captureScopeFiles } from "./helpers/captureCandidates";
import { itemWithAlias } from "../utils/fileSyntax";
import { classifyCaptureTargetScope, markdownFilePathForFolderCandidate, type CaptureTargetScope } from "./helpers/captureTargetScope";
import { namesExistingNote, resolveCaptureTarget as resolveCaptureTargetFromString, type CaptureTargetResolution } from "./helpers/captureTargetResolution";
import { currentFile, missingCurrentNoteMessage } from "../utils/currentFile";

export abstract class CaptureTargetEngine extends QuickAddEngine {
	public abstract choice: ICaptureChoice;
	protected abstract formatter: CaptureChoiceFormatter;
	protected abstract choiceExecutor: IChoiceExecutor;

	/**
	 * The path to capture to: the active file, or the formatted "Capture to",
	 * asking for a file when it names a folder or scope.
	 */
	protected async getFormattedPathToCaptureTo(
		shouldCaptureToActiveFile: boolean,
	): Promise<string> {
		if (shouldCaptureToActiveFile) {
			const activeFile = currentFile(this.app, this.choiceExecutor);
			invariant(activeFile, () => missingCurrentNoteMessage(this.choiceExecutor, "Cannot capture to active file - no active file."));

			return activeFile.path;
		}

		// A preselected target is honoured only for a runtime-picker scope and is
		// confined to it, so a reserved variable injected across a trust boundary
		// cannot redirect a definite-file capture.
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
			"captureTarget",
		);
		// A periodic note is a file, even when a folder has its name.
		if (formattedCaptureTo === this.formatter.periodicNoteTarget?.path) {
			return this.normalizeCaptureFilePath(`${formattedCaptureTo}.md`);
		}
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
	 * The capture-target path supplied out-of-band through the reserved variable
	 * (one-page preflight or CLI), or undefined when absent or blank.
	 */
	protected getPreselectedCaptureTargetPath(): string | undefined {
		return readPreselectedCaptureTarget(
			this.choiceExecutor?.variables,
			this.choice.id,
		);
	}

	/**
	 * Confines a preselected target to what the matching interactive picker would
	 * accept: re-prefixed into a folder scope; for a filter, property or tag
	 * scope, a matched note, or with creation on a new name, but never an
	 * existing unmatched note. Null when outside the scope.
	 */
	protected confinePreselectedToScope(
		scope: CaptureTargetScope,
		preselected: string,
	): string | null {
		const stripped = stripLeadingSlash(preselected);

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

		// With creation on, mirror the picker: a new name is allowed, an existing
		// note (by normalized path or by basename anywhere) is not.
		const vaultBasenames = new Set(
			this.app.vault.getMarkdownFiles().map((f) => f.basename.toLowerCase()),
		);
		return this.captureTargetAlreadyExists(stripped, vaultBasenames)
			? null
			: stripped;
	}

	/** The notes a tag/filter/property capture scope currently matches. */
	protected resolveScopeFiles(scope: CaptureTargetScope): TFile[] {
		return captureScopeFiles(this.app, scope);
	}

	/**
	 * Classifies the formatted "Capture to" via
	 * {@link resolveCaptureTargetFromString}, binding the live vault probes.
	 */
	protected resolveCaptureTarget(
		formattedCaptureTo: string,
	): CaptureTargetResolution {
		return resolveCaptureTargetFromString(formattedCaptureTo, {
			getAbstractFileByPath: (path) =>
				this.app.vault.getAbstractFileByPath(path),
			isFolder: (path) => isFolder(this.app, path),
		});
	}

	/**
	 * Whether a typed picker value already resolves to an existing note, so the
	 * "Create new note" affordance can be suppressed for it. The value is the
	 * displayed name (folder-stripped for folder captures), so the folder prefix is
	 * re-applied and a markdown extension is tried when none is present.
	 */
	protected captureTargetExists(folderPathSlash: string, value: string): boolean {
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

	protected async selectFileInFolder(
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


		const targetFilePath = await this.chooseCaptureTarget(filesInFolder, {
			allowCreate,
			nameIsTaken: (value) => this.captureTargetExists(folderPathSlash, value),
		});

		// Ensure user has selected a file in target folder. InputSuggester allows user to write
		// their own file path, so we need to make sure it's in the target folder.
		const filePath = targetFilePath.startsWith(`${folderPathSlash}`)
			? targetFilePath
			: `${folderPathSlash}${targetFilePath}`;

		return await this.formatFilePath(filePath);
	}

	protected async selectFileWithFilter(filter: FieldFilter): Promise<string> {
		const files = getMarkdownFilesMatchingFilter(this.app, filter);
		return this.selectFileFromSet(
			files,
			"No files matched the capture target filters.",
		);
	}

	protected async selectFileWithProperty(
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
	 * Whether a typed value names an existing note, by exact path (with or without
	 * an extension) or by bare basename in any folder. `vaultBasenames`
	 * (lowercased) is built once per picker.
	 */
	protected captureTargetAlreadyExists(
		value: string,
		vaultBasenames: Set<string>,
	): boolean {
		return namesExistingNote(value, vaultBasenames, (path) => !!this.app.vault.getAbstractFileByPath(path));
	}

	/**
	 * Picker for the vault-wide scopes (tag, property), showing full paths.
	 * "Create new note" is suppressed for any name that already exists.
	 */
	protected async selectFileFromSet(
		files: TFile[],
		notFoundMessage: string,
	): Promise<string> {
		const allowCreate = this.choice.createFileIfItDoesntExist?.enabled ?? false;

		invariant(allowCreate || files.length > 0, notFoundMessage);

		const vaultBasenames = new Set(
			this.app.vault.getMarkdownFiles().map((file) => file.basename.toLowerCase()),
		);
		const targetFilePath = await this.chooseCaptureTarget(files, {
			allowCreate,
			nameIsTaken: (value) => this.captureTargetAlreadyExists(value, vaultBasenames),
			restrictToScope: true,
		});

		return await this.formatFilePath(targetFilePath);
	}

	protected async chooseCaptureTarget(files: TFile[], options: {
		allowCreate: boolean;
		nameIsTaken: (value: string) => boolean;
		restrictToScope?: boolean;
	}): Promise<string> {
		const { paths, labels, aliases, search } = captureCandidates(this.app, files);
		const existingLabels = new Set(labels.map((label) => label.toLowerCase()));
		const aliasNames = new Set(aliases.flat().map((alias) => alias.toLowerCase()));
		// Each search text ends with its path, where a row's path matches start.
		const pathOffsets = new Map(paths.map((path, index) => [path, search[index].length - path.length]));
		const nameIsTaken = (value: string) =>
			existingLabels.has(value.toLowerCase()) || options.nameIsTaken(value);
		const placeholder = options.allowCreate
			? "Choose a note or type to create one" : undefined;
		const selected = String(await routePrompt(this.choiceExecutor, {
			remote: async (provider) => {
				const reply = await promptEngineChoice(provider, {
					items: paths.map((path, index) => ({ value: path, title: labels[index] ?? path })),
					placeholder,
					allowCustomInput: options.allowCreate,
					what: "the capture-target picker",
				});
				// The client matches titles only. A typed alias names its note, as in
				// the in-app picker, so capture into it rather than create a new one.
				const aliased = paths.includes(reply) ? undefined : itemWithAlias(paths, aliases, reply);
				if (aliased !== undefined) return aliased;
				// Folder replies are confined by their caller. Other scopes must
				// reject existing notes that were not offered by this picker.
				if (options.restrictToScope && !paths.includes(reply) && nameIsTaken(reply)) {
					throw new Error(
						`"${reply}" already exists but is not one of the notes this capture targets. ` +
						`Pick one of the offered notes, or type a name that does not exist yet.`,
					);
				}
				return reply;
			},
			headless: () => {
				this.assertInteractiveCaptureTarget();
				throw new Error("unreachable");
			},
			app: () => InputSuggester.Suggest(this.app, labels, paths, {
				placeholder,
				emptyStateText: options.allowCreate ? "Type a note name to create it" : undefined,
				renderItem: (path, el, matches) => renderNotePathSuggestion(el, path, this.app, {
					matches,
					pathOffset: pathOffsets.get(path) ?? 0,
				}),
				searchItems: search,
				aliases,
				allowCustomValue: options.allowCreate,
				customValueLabel: (value) => `Create new note: ${value}`,
				// An alias names its note, so typing one picks that note instead of
				// offering to create a new one.
				valueExists: (value) => aliasNames.has(value.toLowerCase()) || nameIsTaken(value),
			}),
		}));
		invariant(!!selected && selected.length > 0, "No file selected for capture.");
		return selected;
	}

	protected async formatFilePath(captureTo: string) {
		const formattedCaptureTo: string = await this.formatter.formatFileName(
			captureTo,
			"captureTarget",
		);

		return this.normalizeCaptureFilePath(formattedCaptureTo);
	}

	protected normalizeCaptureFilePath(path: string): string {
		const normalizedPath = normalizeGeneratedFilePath(
			stripLeadingSlash(path),
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

		// Contain the target before run()'s existence probe: normalizeGeneratedFilePath
		// leaves absolute/drive/UNC paths for this check, and `C:/secret.md` would
		// otherwise reach adapter.exists outside the vault on Windows.
		if (escapesVaultBoundary(finalPath)) {
			throw new ChoiceAbortError(
				`Refusing to capture to a file outside the vault: "${finalPath}".`,
			);
		}

		return finalPath;
	}

	protected normalizeCaptureFilePathExtension(path: string): string {
		for (const pattern of [MARKDOWN_FILE_EXTENSION_REGEX, CANVAS_FILE_EXTENSION_REGEX]) {
			const extension = path.match(pattern)?.[0];
			if (extension) {
				return `${normalizeGeneratedFilePath(path.replace(pattern, ""),
					"Capture target file path")}${extension}`;
			}
		}

		return normalizeMarkdownFilePath("", path);
	}

	/**
	 * Abort a runtime capture-target file picker on a non-interactive run (CLI
	 * without `ui`) instead of hanging on an unanswerable suggester. Reached when a
	 * format-syntax "Capture to" resolves to a folder/tag/property scope the
	 * requirement collector could not pre-collect.
	 */
	protected assertInteractiveCaptureTarget(): void {
		if (this.choiceExecutor.interactive === false) {
			throw new ChoiceAbortError(
				`'${this.choice.name}' needs to ask which note to capture into, but this run is non-interactive. ` +
				`Point "Capture to" at a specific file, or re-run with the ui flag.`,
			);
		}
	}

}
