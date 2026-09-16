import { Notice } from "obsidian";
import { QuickAddEngine } from "./QuickAddEngine";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputSuggester from "../gui/InputSuggester/inputSuggester";
import {
	INVALID_FOLDER_CHARS_REGEX, INVALID_FOLDER_CONTROL_CHARS_REGEX,
	INVALID_FOLDER_TRAILING_CHARS_REGEX, isReservedWindowsDeviceName
} from "../utils/pathValidation";
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
	topItems?: Array<{ path: string; label: string }>;
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
	displayByNormalized: Map<string, string>;
};

type FolderSelectionContext = FolderSuggestions & {
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

export abstract class FolderSelectionEngine extends QuickAddEngine {
	protected async getOrCreateFolder(
		folders: string[],
		options: FolderChoiceOptions,
	): Promise<string> {
		// Decide from configured destinations only when any exist. `topItems` is
		// a shortcut on an already-open chooser, so counting it turned one
		// specified folder into a prompt whenever the active file lived in a
		// descendant (#1705). With no destinations, that same row is the
		// documented active-file fallback and must stay in the decision.
		const destinations = this.buildFolderSelectionContext(folders, {
			...options,
			topItems: folders.length > 0 ? [] : (options.topItems ?? []),
		});

		if (!this.shouldPromptForFolder(destinations)) {
			return await this.handleSingleSelection(destinations);
		}

		const context = this.buildFolderSelectionContext(folders, options);
		const selection = await this.promptUntilAllowed(context, options.executor);
		return selection.isEmpty ? "" : selection.resolved;
	}

	private buildFolderSelectionContext(
		folders: string[],
		options: FolderChoiceOptions,
	): FolderSelectionContext {
		const allowCreate = options.allowCreate ?? false;
		const allowedRoots =
			options.allowedRoots?.map((root) => this.normalizeFolderPath(root)) ?? [];

		const suggestions = this.buildFolderSuggestions(
			folders, options.topItems ?? [],
			allowedRoots.length > 0 ? allowedRoots : undefined,
		);

		return {
			...suggestions,
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

	private async promptForFolder(
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
							this.app,
							context.displayItems,
							context.items,
							{
								placeholder,
								renderItem: (item, el) => {
									this.renderFolderSuggestion(
										item,
										el,
										context.canonicalByNormalized,
										context.displayByNormalized,
									);
								},
							},
						)
						: GenericSuggester.Suggest(
							this.app,
							context.displayItems,
							context.items,
							context.placeholder,
						),
			}),
		);
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
			const raw = await this.promptForFolder(context, executor);
			const selection = await this.resolveSelection(raw, context);

			if (!selection.isAllowed) {
				lastRejection = folderNotAllowedMessage(context.allowedRoots);
				this.showFolderNotAllowedNotice(context.allowedRoots);
				continue;
			}
			if (selection.isEmpty) return selection;

			try {
				this.validateFolderPath(selection.resolved);
			} catch (error) {
				if (error instanceof InvalidFolderPathError) {
					lastRejection = error.message;
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
		new Notice(folderNotAllowedMessage(roots));
	}

	private buildFolderSuggestions(
		folders: string[],
		topItems: Array<{ path: string; label: string }>,
		allowedRoots?: string[],
	): FolderSuggestions {
		const items: string[] = [];
		const displayItems: string[] = [];
		const canonicalByNormalized = new Map<string, string>();
		const displayByNormalized = new Map<string, string>();

		const addItem = (path: string, label?: string) => {
			const normalized = this.normalizeFolderPath(path);
			if (canonicalByNormalized.has(normalized)) return;
			if (
				allowedRoots &&
				allowedRoots.length > 0 &&
				!this.isPathAllowed(normalized, allowedRoots)
			) {
				return;
			}
			items.push(path);
			displayItems.push(label ?? path);
			canonicalByNormalized.set(normalized, path);
			if (label) displayByNormalized.set(normalized, label);
		};

		for (const item of topItems) addItem(item.path, item.label);
		for (const folder of folders) addItem(folder);

		return {
			items,
			displayItems,
			canonicalByNormalized,
			displayByNormalized,
		};
	}

	private renderFolderSuggestion(
		item: string,
		el: HTMLElement,
		existing: ReadonlyMap<string, string>,
		displayByNormalized: Map<string, string>,
	): void {
		el.empty();
		el.classList.add("mod-complex");
		const normalized = this.normalizeFolderPath(item);
		const display = displayByNormalized.get(normalized);
		const displayPath = item || "/";
		const isExisting = existing.has(normalized);
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

}
