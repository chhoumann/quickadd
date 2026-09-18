import { TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { CaptureChoiceFormatter } from "../formatters/captureChoiceFormatter";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
import { BASE_FILE_EXTENSION_REGEX, CANVAS_FILE_EXTENSION_REGEX, MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { getMarkdownFilesInFolder, getMarkdownFilesMatchingFilter, getMarkdownFilesWithProperty, isFolder } from "../utilityObsidian";
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
import { classifyCaptureTargetScope, markdownFilePathForFolderCandidate, type CaptureTargetScope } from "./helpers/captureTargetScope";
import { resolveCaptureTarget as resolveCaptureTargetFromString, type CaptureTargetResolution } from "./helpers/captureTargetResolution";

export abstract class CaptureTargetEngine extends QuickAddChoiceEngine {
	public abstract choice: ICaptureChoice;
	protected abstract formatter: CaptureChoiceFormatter;
	protected abstract choiceExecutor: IChoiceExecutor;

	/**
		* Gets a formatted file path to capture content to, either the active file or a specified location.
		* If capturing to a folder, suggests a file within the folder to capture the content to.
		*
		* @param {boolean} shouldCaptureToActiveFile - Determines if the content should be captured to the active file.
		* @returns {Promise<string>} A promise that resolves to the formatted file path where the content should be captured.
		*
		* @throws {Error} Throws an error if there's no active file when trying to capture to active file,
		*                 if the capture path is invalid, or if the target folder is empty.
		*/
	protected async getFormattedPathToCaptureTo(
		shouldCaptureToActiveFile: boolean,
	): Promise<string> {
		if (shouldCaptureToActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();
			invariant(activeFile, "Cannot capture to active file - no active file.");

			return activeFile.path;
		}

		// A preselected capture target (the trusted one-page preflight pick, or a
		// non-interactive CLI `value-__qa.captureTargetFilePath`) is honoured ONLY
		// when the configured "Capture to" actually needs a runtime file pick — the
		// same scopes the requirement collector emits the pick for — AND the value is
		// confined to that scope. For a definite-file target the configured path is
		// authoritative, so a reserved variable injected across a trust boundary (an
		// obsidian:// URI, the CLI, or a {{VALUE:__qa.…}} token in a synced/imported
		// choice) cannot redirect the capture to an arbitrary note.
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
	 * The capture-target file path supplied out-of-band for this run, read from the
	 * reserved internal variable: set by trusted preflight plumbing (the one-page
	 * input modal) or by a non-interactive CLI `value-__qa.captureTargetFilePath`.
	 * Returns `undefined` when absent or blank. The caller honours it only for a
	 * runtime-picker scope and confines it to that scope, so a reserved key injected
	 * across a trust boundary cannot hijack a definite-file capture target.
	 */
	protected getPreselectedCaptureTargetPath(): string | undefined {
		return readPreselectedCaptureTarget(
			this.choiceExecutor?.variables,
			this.choice.id,
		);
	}

	/**
	 * Confines a preselected capture target to the SAME destination set the matching
	 * interactive picker would accept, so the value can never escape the configured
	 * "Capture to" scope:
	 *  - folder: re-prefixed into the folder, mirroring {@link selectFileInFolder}
	 *    (an empty folderPathSlash is the whole-vault scope, so no confinement).
	 *  - filter/property/tag: a note the scope already matches is always allowed.
	 *    With creation OFF nothing else is (the picker only offers matched notes);
	 *    with creation ON a NEW name is allowed too, but an EXISTING note the scope
	 *    does not match is rejected - the picker suppresses it (InputSuggester
	 *    getSuggestions, valueExists), and honouring it would let an injected value
	 *    append to an arbitrary existing note.
	 * Returns `null` when the value is outside the scope; the caller then falls back
	 * to the normal picker/resolution instead of honouring it.
	 */
	protected confinePreselectedToScope(
		scope: CaptureTargetScope,
		preselected: string,
	): string | null {
		const stripped = this.stripLeadingSlash(preselected);

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

		// Creation is on: the picker offers a NEW name but suppresses any existing
		// note (by normalized path OR basename anywhere - selectFileFromSet +
		// captureTargetAlreadyExists). Mirror it exactly so an injected value cannot
		// append to an arbitrary existing note or spawn a duplicate-basename note.
		// captureTargetAlreadyExists normalizes the value the same way the eventual
		// write does (trailing space/dot stripped), so a `Note.md ` variant of an
		// existing note is still caught.
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
	 * Adapter: classifies the formatted "Capture to" string into a concrete
	 * destination via the pure {@link resolveCaptureTargetFromString}, binding the
	 * live vault probes. Kept as a method so the existing call site and tests stay
	 * unchanged.
	 */
	protected resolveCaptureTarget(
		formattedCaptureTo: string,
	): CaptureTargetResolution {
		return resolveCaptureTargetFromString(formattedCaptureTo, {
			getAbstractFileByPath: (path) =>
				this.app.vault.getAbstractFileByPath(path),
			isFolder: (path) => isFolder(this.app, path),
			normalizeMarkdownFilePath: (folderPath, fileName) =>
				this.normalizeMarkdownFilePath(folderPath, fileName),
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
	 * Whether a typed picker value already resolves to an existing note — by exact
	 * path (root or a typed sub-path, with/without a .md/.canvas extension) OR by a
	 * bare basename matching a note in ANY folder. `vaultBasenames` is the set of
	 * existing note basenames (lowercased), built once per picker so this is O(1)
	 * per keystroke. Suppresses the "Create new note" affordance for any name that
	 * already exists, so a vault-wide picker never mislabels an existing note as
	 * creatable, captures into it, or spawns a duplicate-basename note.
	 */
	protected captureTargetAlreadyExists(
		value: string,
		vaultBasenames: Set<string>,
	): boolean {
		const raw = value.trim();
		if (!raw) return false;
		let normalized: string;
		try {
			normalized = normalizeGeneratedFilePath(
				raw,
				"Capture target file path",
			);
		} catch {
			return false;
		}

		const base = normalized.replace(/\.(md|canvas)$/i, "");
		const pathCandidates = [normalized, `${base}.md`, `${base}.canvas`];
		if (
			pathCandidates.some(
				(path) => !!this.app.vault.getAbstractFileByPath(path),
			)
		) {
			return true;
		}
		const basename = base.slice(base.lastIndexOf("/") + 1);
		return vaultBasenames.has(basename.toLowerCase());
	}

	/**
	 * Shared picker for the "anywhere in the vault" capture scopes (tag, property):
	 * the matched notes can live in any folder, so the picker shows full paths. The
	 * "Create new note" affordance is suppressed for any name that already exists
	 * in the vault (by path or basename, in any folder), so typing an existing —
	 * possibly non-matching — note never mislabels as "create", never silently
	 * captures into that file, and never spawns a duplicate-basename note.
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
		const { paths, labels, search } = captureCandidates(this.app, files);
		const existingLabels = new Set(labels.map((label) => label.toLowerCase()));
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
				renderItem: (path, el) => renderNotePathSuggestion(el, path, this.app),
				searchItems: search,
				allowCustomValue: options.allowCreate,
				customValueLabel: (value) => `Create new note: ${value}`,
				valueExists: nameIsTaken,
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
			this.stripLeadingSlash(path),
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

		// Contain the assembled target at assembly — BEFORE the run() existence probe
		// (`fileExists(filePath)`) that precedes the create sink. normalizeGeneratedFilePath
		// intentionally leaves absolute/drive/UNC paths for the boundary check, so without
		// this a 'Capture to' formatting to e.g. "C:/secret.md" would reach adapter.exists
		// out-of-vault on Windows before createFileWithInput could reject it. Mirrors the
		// Template path's normalizeTemplateFilePath guard.
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

		return this.normalizeMarkdownFilePath("", path);
	}

	/**
	 * For "Choose heading when capturing": prompt the user with a dropdown of the
	 * destination's headings and set the picked line as the formatter's insert-after
	 * override. The items are byte-exact heading LINES from `content` (so the formatter's
	 * literal search and create-if-not-found round-trip exactly, the #742 invariant),
	 * parsed with the same `getMarkdownHeadings` the inserter uses (so what is offered can
	 * never desync from what is matched). `allowCustomValue` lets the user type a NEW heading
	 * only when "Create line if not found" is enabled — otherwise the override path can only
	 * match an existing line and would abort after the user already typed one (the picker must
	 * never offer to create a heading the engine cannot create). `content` is the
	 * destination's current text — a note body, or a Canvas text card's text. A no-op unless
	 * the choice is in heading mode. Cancelling aborts the capture cleanly (UserCancelError),
	 * before any write.
	 */
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
