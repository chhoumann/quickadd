import { Notice, type App } from "obsidian";
import { ensureFolder } from "./vaultFiles";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputSuggester from "../gui/InputSuggester/inputSuggester";
import {
	INVALID_FOLDER_CHARS_REGEX, INVALID_FOLDER_CONTROL_CHARS_REGEX,
	INVALID_FOLDER_TRAILING_CHARS_REGEX, isReservedWindowsDeviceName
} from "../utils/pathValidation";
import { normalizeVaultPath, normalizeVaultPathSeparators } from "../utils/pathUtils";
import { MacroAbortError } from "../errors/MacroAbortError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { routePrompt, type PromptRoutingContext } from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";

/** One wording for both surfaces: the desktop Notice, and the remote run's abort. */
function folderNotAllowedMessage(roots: string[]): string {
	const displayRoots = roots.map((root) => (root ? root : "/"));
	const list =
		displayRoots.length > 3
			? `${displayRoots.slice(0, 3).join(", ")}...`
			: displayRoots.join(", ");
	return `Folder must be under: ${list}`;
}

/**
 * How many times a REMOTE run may re-ask the folder chooser before giving up. The
 * in-app loop is unbounded because the Notice tells the user why their pick was
 * refused; a client sees an identical prompt with no explanation, so looping there
 * is indistinguishable from a hang.
 */
const MAX_REMOTE_FOLDER_ATTEMPTS = 3;

type FolderChoiceOptions = {
	allowCreate?: boolean;
	placeholder?: string;
	allowedRoots?: string[];
	/** The active file's folder, offered first as a "Current folder" shortcut. */
	currentFolder?: string;
	/**
	 * Where the folder chooser goes: to a connected interactive client, to an abort
	 * (a non-interactive CLI run has no one to answer it), or to the Obsidian modal.
	 *
	 * Required, not optional. It replaced a bare `interactive?: boolean` that could
	 * only ever say "do not open the modal" - which is why an INTERACTIVE run, where
	 * the flag is `true`, opened the chooser on a desktop nobody was watching (#1614).
	 * A single configured folder never prompts, so it is unaffected either way.
	 */
	executor: PromptRoutingContext;
};

type FolderSuggestions = {
	items: string[];
	displayItems: string[];
	canonicalByNormalized: Map<string, string>;
	/** The normalized key of the current-folder shortcut, when it is offered. */
	currentFolderKey: string | null;
};

const CURRENT_FOLDER_LABEL = "<current folder>";

type FolderSelectionContext = FolderSuggestions & {
	allowCreate: boolean;
	allowedRoots: string[];
	placeholder?: string;
};

type FolderSelection = {
	raw: string;
	normalized: string;
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

/**
 * The folder a new note goes in: the single configured destination, or the one
 * the user picks (or types, with `allowCreate`) from several. A typed folder
 * that does not exist yet is created.
 */
export async function chooseFolder(
	app: App,
	folders: string[],
	options: FolderChoiceOptions,
): Promise<string> {
	// Decide from configured destinations only when any exist. The current
	// folder is a shortcut on an already-open chooser, so counting it turned one
	// specified folder into a prompt whenever the active file lived in a
	// descendant (#1705). With no destinations, that same row is the
	// documented active-file fallback and must stay in the decision.
	const destinations = buildFolderSelectionContext(folders, {
		...options,
		currentFolder: folders.length > 0 ? undefined : options.currentFolder,
	});

	if (!shouldPromptForFolder(destinations)) {
		return await handleSingleSelection(app, destinations);
	}

	const context = buildFolderSelectionContext(folders, options);
	const selection = await promptUntilAllowed(app, context, options.executor);
	return selection.isEmpty ? "" : selection.normalized;
}

function buildFolderSelectionContext(
	folders: string[],
	options: FolderChoiceOptions,
): FolderSelectionContext {
	const allowCreate = options.allowCreate ?? false;
	const allowedRoots =
		options.allowedRoots?.map((root) => normalizeVaultPathSeparators(root)) ?? [];

	const suggestions = buildFolderSuggestions(
		folders, options.currentFolder,
		allowedRoots.length > 0 ? allowedRoots : undefined,
	);

	return {
		...suggestions,
		allowCreate,
		allowedRoots,
		placeholder: options.placeholder,
	};
}

function shouldPromptForFolder(context: FolderSelectionContext): boolean {
	return (
		context.items.length > 1 ||
		(context.allowCreate && context.items.length === 0)
	);
}

async function promptForFolder(
	app: App,
	context: FolderSelectionContext,
	executor: PromptRoutingContext,
): Promise<string> {
	const placeholder =
		context.placeholder ?? "Choose a folder or type to create one";

	return String(
		await routePrompt(executor, {
			// The client renders its own list, so the in-app "Create folder" badge
			// does not travel - but `allowCreate` does, as `allowCustomInput`, which
			// is the part that changes what the run can DO. Every reply still goes
			// through resolveSelection -> allowedRoots -> validateFolderPath below,
			// so a routed answer is confined exactly like a typed-in one.
			remote: (provider) =>
				promptEngineChoice(provider, {
					items: context.items.map((item, index) => ({
						value: item,
						title: context.displayItems[index] ?? item,
					})),
					placeholder,
					allowCustomInput: context.allowCreate,
					what: "the folder chooser",
				}),
			// Non-interactive run (CLI without `ui`): no one can answer, so opening
			// it would hang. Abort with an actionable error.
			headless: () => {
				throw new ChoiceAbortError(
					"This choice needs to ask which folder to create the note in, but this run is non-interactive. " +
					"Configure a single target folder, or re-run with the ui flag.",
				);
			},
			app: () =>
				context.allowCreate
					? InputSuggester.Suggest(
						app,
						context.displayItems,
						context.items,
						{
							placeholder,
							renderItem: (item, el) => renderFolderSuggestion(item, el, context),
						},
					)
					: GenericSuggester.Suggest(
						app,
						context.displayItems,
						context.items,
						context.placeholder,
					),
		}),
	);
}

async function resolveSelection(
	app: App,
	raw: string,
	context: FolderSelectionContext,
): Promise<FolderSelection> {
	const key = normalizeVaultPath(raw);
	const isEmpty = key.length === 0;

	// Trimming is for matching only. An existing folder keeps the spelling
	// Obsidian owns, and a new one keeps the name as typed (minus separators),
	// so a name that starts with a space is never written elsewhere.
	const normalized =
		context.canonicalByNormalized.get(key) ?? normalizeVaultPathSeparators(raw);
	const exists = isEmpty
		? false
		: context.canonicalByNormalized.has(key) ||
		(await app.vault.adapter.exists(normalized));

	const isAllowed =
		context.allowedRoots.length === 0
			? true
			: isPathAllowed(normalized, context.allowedRoots);

	return {
		raw,
		normalized,
		exists,
		isAllowed,
		isEmpty,
	};
}

async function promptUntilAllowed(
	app: App,
	context: FolderSelectionContext,
	executor: PromptRoutingContext,
): Promise<FolderSelection> {
	// A rejected selection is re-asked, and in Obsidian the reason arrives as a
	// Notice next to the reopened modal. A remote client gets no Notice, so the
	// re-prompt is indistinguishable from the first one - an unbounded loop of an
	// identical question. Bound it there and end with the text the Notice carries.
	let remoteAttempts = executor.promptProvider ? MAX_REMOTE_FOLDER_ATTEMPTS : 0;
	// The reason the LAST answer was refused, so the abort says what the Notice
	// would have. The loop rejects for two different reasons - a disallowed root and
	// a name Obsidian cannot use - and blaming the roots for an invalid name would
	// send the client looking in the wrong place.
	let lastRejection: string | null = null;

	// Keep prompting until the user provides an allowed selection or cancels.
	for (;;) {
		if (executor.promptProvider && remoteAttempts-- <= 0) {
			throw new ChoiceAbortError(
				lastRejection ?? folderNotAllowedMessage(context.allowedRoots),
			);
		}
		const raw = await promptForFolder(app, context, executor);
		const selection = await resolveSelection(app, raw, context);

		if (!selection.isAllowed) {
			lastRejection = folderNotAllowedMessage(context.allowedRoots);
			new Notice(lastRejection);
			continue;
		}
		if (selection.isEmpty) return selection;

		try {
			validateFolderPath(selection.normalized);
		} catch (error) {
			if (error instanceof InvalidFolderPathError) {
				lastRejection = error.message;
				new Notice(error.message);
				continue;
			}
			throw error;
		}

		await ensureFolderExists(app, selection);

		return selection;
	}
}

async function ensureFolderExists(app: App, selection: FolderSelection): Promise<void> {
	if (selection.isEmpty || selection.exists) return;
	await ensureFolder(app, selection.normalized);
}

async function handleSingleSelection(
	app: App,
	context: FolderSelectionContext,
): Promise<string> {
	const raw = context.items[0] ?? "";
	const selection = await resolveSelection(app, raw, context);

	if (selection.isEmpty) return "";
	if (!selection.isAllowed) {
		new Notice(folderNotAllowedMessage(context.allowedRoots));
		throw new MacroAbortError("Selected folder not allowed.");
	}

	try {
		validateFolderPath(selection.normalized);
	} catch (error) {
		if (error instanceof InvalidFolderPathError) {
			new Notice(error.message);
			return "";
		}
		throw error;
	}

	await ensureFolderExists(app, selection);
	return selection.normalized;
}

function validateFolderPath(path: string): void {
	if (!path) return;

	// The path is validated as given: trimming here would hide a forbidden
	// trailing space on the last segment from the check below.
	for (const segment of path.split("/")) {
		validateFolderSegment(segment);
	}
}

function validateFolderSegment(segment: string): void {
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

	// No trailing-dot/space trim is needed here: the guard above already
	// threw for any segment ending in '.' or ' ', so the historical
	// `.replace(/[. ]+$/u, "")` was a guaranteed no-op - while still costing
	// quadratic backtracking on a long interior dot/space run in a
	// format-resolved folder name (same shape as sanitizeVaultPath's).
	const base = segment.split(".")[0] ?? "";
	if (base && isReservedWindowsDeviceName(base)) {
		throw new InvalidFolderPathError(
			"Folder name cannot be a reserved name like CON, PRN, AUX, NUL, COM1-9, or LPT1-9.",
		);
	}
}

function isPathAllowed(path: string, roots: string[]): boolean {
	const normalizedPath = normalizeVaultPathSeparators(path);
	for (const root of roots) {
		if (!root) return true;
		if (normalizedPath === root) return true;
		if (normalizedPath.startsWith(`${root}/`)) return true;
	}
	return false;
}

/**
 * The folder a configured or typed path stands for: separators are cleaned,
 * the name is not. ` Work/` is the vault's ` Work`, `out\nested/` is
 * `out/nested`, and a new ` Work/new` is created under ` Work` rather than
 * as `Work/new`. Trimming belongs to matching (see resolveSelection), never
 * to identity.
 */
export function canonicalFolderPath(path: string): string {
	return normalizeVaultPathSeparators(path);
}

function buildFolderSuggestions(
	folders: string[],
	currentFolder: string | undefined,
	allowedRoots?: string[],
): FolderSuggestions {
	const items: string[] = [];
	const displayItems: string[] = [];
	const canonicalByNormalized = new Map<string, string>();
	let currentFolderKey: string | null = null;

	const addItem = (path: string, label?: string): boolean => {
		const normalized = normalizeVaultPath(path);
		if (canonicalByNormalized.has(normalized)) return false;
		if (
			allowedRoots &&
			allowedRoots.length > 0 &&
			!isPathAllowed(path, allowedRoots)
		) {
			return false;
		}
		items.push(path);
		displayItems.push(label ?? path);
		canonicalByNormalized.set(normalized, canonicalFolderPath(path));
		return true;
	};

	if (currentFolder !== undefined && addItem(currentFolder, CURRENT_FOLDER_LABEL)) {
		currentFolderKey = normalizeVaultPath(currentFolder);
	}
	for (const folder of folders) addItem(folder);

	return {
		items,
		displayItems,
		canonicalByNormalized,
		currentFolderKey,
	};
}

function renderFolderSuggestion(
	item: string,
	el: HTMLElement,
	context: FolderSuggestions,
): void {
	el.empty();
	el.classList.add("mod-complex");
	const normalized = normalizeVaultPath(item);
	const displayPath = item || "/";
	let indicator = "";

	if (normalized === context.currentFolderKey) {
		indicator = "Current folder";
	} else if (!context.canonicalByNormalized.has(normalized)) {
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
