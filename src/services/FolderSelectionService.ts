import type { App } from "obsidian";
import { Notice } from "obsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputSuggester from "../gui/InputSuggester/inputSuggester";
import { MacroAbortError } from "../errors/MacroAbortError";
import { isCancellationError } from "../utils/errorUtils";
import {
	INVALID_FOLDER_CHARS_REGEX,
	INVALID_FOLDER_CONTROL_CHARS_REGEX,
	INVALID_FOLDER_TRAILING_CHARS_REGEX,
	isReservedWindowsDeviceName,
} from "../utils/pathValidation";
import { VaultFileService } from "./VaultFileService";

export type FolderChoiceOptions = {
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

class InvalidFolderPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidFolderPathError";
	}
}

export class FolderSelectionService {
	public constructor(
		private readonly app: App,
		private readonly vaultFileService = new VaultFileService(app),
	) {}

	public async getOrCreateFolder(
		folders: string[],
		options: FolderChoiceOptions = {},
	): Promise<string> {
		const context = this.buildFolderSelectionContext(folders, options);

		if (!this.shouldPromptForFolder(context)) {
			return await this.handleSingleSelection(context);
		}

		const selection = await this.promptUntilAllowed(context);
		return selection.isEmpty ? "" : selection.resolved;
	}

	public normalizeFolderPath(path: string): string {
		return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
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

	private async promptUntilAllowed(
		context: FolderSelectionContext,
	): Promise<FolderSelection> {
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
		await this.vaultFileService.createFolder(selection.resolved);
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
}
