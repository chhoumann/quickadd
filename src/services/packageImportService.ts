import { Buffer } from "buffer";
import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";
import {
	isQuickAddPackage,
	QUICKADD_PACKAGE_SCHEMA_VERSION,
} from "../types/packages/QuickAddPackage";
import { flattenChoices } from "../utils/choiceUtils";
import type { ICommand } from "../types/macros/ICommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import { CommandType } from "../types/macros/CommandType";
import { log } from "../logger/logManager";

export interface LoadedQuickAddPackage {
	pkg: QuickAddPackage;
	path: string;
}

export interface ChoiceConflict {
	choiceId: string;
	name: string;
	parentChoiceId: string | null;
	pathHint: string[];
	exists: boolean;
}

export interface AssetConflict {
	originalPath: string;
	exists: boolean;
	kind: QuickAddPackage["assets"][number]["kind"];
}

export interface PackageAnalysis {
	choiceConflicts: ChoiceConflict[];
	assetConflicts: AssetConflict[];
}

export type ChoiceImportMode = "import" | "overwrite" | "duplicate" | "skip";
export type AssetImportMode = "write" | "overwrite" | "skip";

export interface ChoiceImportDecision {
	choiceId: string;
	mode: ChoiceImportMode;
}

export interface AssetImportDecision {
	originalPath: string;
	mode: AssetImportMode;
}

export interface ApplyImportOptions {
	app: App;
	existingChoices: IChoice[];
	pkg: QuickAddPackage;
	choiceDecisions: ChoiceImportDecision[];
	assetDecisions: AssetImportDecision[];
}

export interface ApplyImportResult {
	updatedChoices: IChoice[];
	addedChoiceIds: string[];
	overwrittenChoiceIds: string[];
	skippedChoiceIds: string[];
	writtenAssets: string[];
	skippedAssets: string[];
}

export async function readQuickAddPackage(
	app: App,
	packagePath: string,
): Promise<LoadedQuickAddPackage> {
	const normalized = normalizePath(packagePath.trim());
	if (!normalized) throw new Error("Package path cannot be empty.");

	const exists = await app.vault.adapter.exists(normalized);
	if (!exists) throw new Error(`Package file not found: ${normalized}`);

	const raw = await app.vault.adapter.read(normalized);
	const parsed = parseQuickAddPackage(raw);

	return {
		pkg: parsed,
		path: normalized,
	};
}

export function parseQuickAddPackage(raw: string): QuickAddPackage {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Package content is not valid JSON: ${(error as Error)?.message ?? error}`,
		);
	}

	if (!isQuickAddPackage(parsed)) {
		throw new Error("Content is not a valid QuickAdd package.");
	}

	if (parsed.schemaVersion > QUICKADD_PACKAGE_SCHEMA_VERSION) {
		throw new Error(
			`Package schema version ${parsed.schemaVersion} is newer than this plugin supports (${QUICKADD_PACKAGE_SCHEMA_VERSION}).`,
		);
	}

	return parsed;
}

export async function analysePackage(
	app: App,
	existingChoices: IChoice[],
	pkg: QuickAddPackage,
): Promise<PackageAnalysis> {
	const existingById = new Map(
		flattenChoices(existingChoices).map((choice) => [choice.id, choice]),
	);

	const choiceConflicts: ChoiceConflict[] = pkg.choices.map((entry) => ({
		choiceId: entry.choice.id,
		name: entry.choice.name,
		parentChoiceId: entry.parentChoiceId,
		pathHint: entry.pathHint ?? [],
		exists: existingById.has(entry.choice.id),
	}));

	const assetConflicts: AssetConflict[] = [];
	for (const asset of pkg.assets) {
		const exists = await app.vault.adapter.exists(asset.originalPath);
		assetConflicts.push({
			originalPath: asset.originalPath,
			exists,
			kind: asset.kind,
		});
	}

	return { choiceConflicts, assetConflicts };
}

export async function applyPackageImport(
	options: ApplyImportOptions,
): Promise<ApplyImportResult> {
	const { app, existingChoices, pkg } = options;
	const choiceDecisionMap: Map<string, ChoiceImportMode> = new Map(
		options.choiceDecisions.map((decision) => [decision.choiceId, decision.mode]),
	);
	const assetDecisionMap: Map<string, AssetImportMode> = new Map(
		options.assetDecisions.map((decision) => [
			decision.originalPath,
			decision.mode,
		]),
	);

	const catalog = new Map(pkg.choices.map((entry) => [entry.choice.id, entry]));
	const importableChoiceIds = new Set<string>();

	const isChoiceImportable = (choiceId: string): boolean => {
		const decision = choiceDecisionMap.get(choiceId) as
			| ChoiceImportMode
			| undefined;
		if (decision === "skip") return false;

		const entry = catalog.get(choiceId);
		if (!entry) return false;

		if (entry.parentChoiceId) {
			if (!catalog.has(entry.parentChoiceId)) {
				// Parent not part of package; import decision stands alone.
				return true;
			}
			return isChoiceImportable(entry.parentChoiceId);
		}

		return true;
	};

	for (const entry of pkg.choices) {
		if (isChoiceImportable(entry.choice.id)) {
			importableChoiceIds.add(entry.choice.id);
		}
	}

	const duplicatedOriginalIds = new Set<string>();
	const idMap = new Map<string, string>();

	const isDuplicated = (choiceId: string): boolean => {
		if (!importableChoiceIds.has(choiceId)) return false;
		const cached = duplicatedOriginalIds.has(choiceId);
		if (cached) return true;

		const decision = choiceDecisionMap.get(choiceId);
		if (decision === "duplicate") {
			duplicatedOriginalIds.add(choiceId);
			return true;
		}

		const parentId = catalog.get(choiceId)?.parentChoiceId ?? null;
		if (!parentId) return false;
		const parentDecision = choiceDecisionMap.get(parentId);
		if (parentDecision === "duplicate") {
			duplicatedOriginalIds.add(choiceId);
			return true;
		}
		if (!importableChoiceIds.has(parentId)) return false;
		if (isDuplicated(parentId)) {
			duplicatedOriginalIds.add(choiceId);
			return true;
		}

		return false;
	};

	for (const entry of pkg.choices) {
		if (!importableChoiceIds.has(entry.choice.id)) continue;
		const shouldDuplicate = isDuplicated(entry.choice.id);
		const newId = shouldDuplicate ? uuidv4() : entry.choice.id;
		idMap.set(entry.choice.id, newId);
	}

	const updatedChoices = structuredClone(existingChoices);
	const addedChoiceIds: string[] = [];
	const overwrittenChoiceIds: string[] = [];
	const skippedChoiceIds: string[] = [];

	// Prepare cloned choices with remapped IDs
	const preparedChoices = new Map<string, IChoice>();
	for (const entry of pkg.choices) {
		if (!importableChoiceIds.has(entry.choice.id)) {
			skippedChoiceIds.push(entry.choice.id);
			continue;
		}

		const clone = structuredClone(entry.choice);
		const remapped = remapChoiceTree(clone, idMap);
		preparedChoices.set(entry.choice.id, remapped);
	}

	const handledChoices = new Set<string>();

	for (const entry of pkg.choices) {
		const originalId = entry.choice.id;
		if (!importableChoiceIds.has(originalId)) continue;
		if (handledChoices.has(originalId)) continue;

		const choiceClone = preparedChoices.get(originalId);
		if (!choiceClone) continue;

		const finalId = choiceClone.id;
		const decision = choiceDecisionMap.get(originalId) ?? "import";

		const parentId = entry.parentChoiceId;
		const parentImported =
			parentId && importableChoiceIds.has(parentId)
				? preparedChoices.get(parentId)
				: null;

		if (parentImported) {
			// Parent will be handled separately; avoid double-inserting children.
			handledChoices.add(originalId);
			continue;
		}

		if (decision === "overwrite" || decision === "import") {
			const replaced = replaceChoiceInTree(updatedChoices, choiceClone);
			if (replaced) {
				overwrittenChoiceIds.push(finalId);
				handledChoices.add(originalId);
				continue;
			}
		}

		if (parentId) {
			const resolvedParentId = idMap.get(parentId) ?? parentId;
			const insertedUnderParent = insertUnderParent(
				updatedChoices,
				resolvedParentId,
				choiceClone,
			);
			if (insertedUnderParent) {
				addedChoiceIds.push(finalId);
				handledChoices.add(originalId);
				continue;
			}
			const parentByPath = findMultiByPath(
				updatedChoices,
				entry.pathHint.slice(0, -1),
			);
			if (parentByPath) {
				insertIntoMulti(parentByPath, choiceClone);
				addedChoiceIds.push(finalId);
				handledChoices.add(originalId);
				continue;
			}
			log.logWarning(
				`QuickAdd import: could not locate parent for '${entry.choice.name}'. Adding to root.`,
			);
		}

		// Default: append to root
		const existingIndex = updatedChoices.findIndex((c) => c.id === finalId);
		if (existingIndex !== -1) {
			updatedChoices.splice(existingIndex, 1, choiceClone);
			overwrittenChoiceIds.push(finalId);
		} else {
			updatedChoices.push(choiceClone);
			addedChoiceIds.push(finalId);
		}

		handledChoices.add(originalId);
	}

	const writtenAssets: string[] = [];
	const skippedAssets: string[] = [];

	for (const asset of pkg.assets) {
		const explicit = assetDecisionMap.get(asset.originalPath);
		const exists = await assetExists(app, asset.originalPath);
		const mode = explicit ?? (exists ? "overwrite" : "write");

		if (mode === "skip") {
			skippedAssets.push(asset.originalPath);
			continue;
		}

		if (!exists || mode === "overwrite" || mode === "write") {
			await ensureParentFolders(app, asset.originalPath);
			const content = Buffer.from(asset.content, "base64").toString("utf8");
			await app.vault.adapter.write(asset.originalPath, content);
			writtenAssets.push(asset.originalPath);
		}
	}

	return {
		updatedChoices,
		addedChoiceIds,
		overwrittenChoiceIds,
		skippedChoiceIds,
		writtenAssets,
		skippedAssets,
	};
}

async function assetExists(app: App, path: string): Promise<boolean> {
	try {
		return await app.vault.adapter.exists(path);
	} catch {
		return false;
	}
}

function remapChoiceTree(choice: IChoice, idMap: Map<string, string>): IChoice {
	const originalId = choice.id;
	const finalId = idMap.get(originalId) ?? originalId;
	choice.id = finalId;
	const isDuplicated = finalId !== originalId;

	if (choice.type === "Macro") {
		const macroChoice = choice as IMacroChoice;
		if (isDuplicated) {
			macroChoice.macro.id = uuidv4();
		}
		remapCommands(macroChoice.macro.commands, idMap, isDuplicated);
	}

	if (choice.type === "Multi") {
		const multi = choice as IMultiChoice;
		if (Array.isArray(multi.choices)) {
			multi.choices = multi.choices.map((child) =>
				remapChoiceTree(child, idMap),
			);
		}
	}

	return choice;
}

function remapCommands(
	commands: ICommand[],
	idMap: Map<string, string>,
	shouldRegenerateIds: boolean,
): void {
	for (const command of commands) {
		if (!command) continue;

		if (shouldRegenerateIds) {
			command.id = uuidv4();
		}

		switch (command.type) {
			case CommandType.Choice: {
				const choiceCommand = command as IChoiceCommand;
				const mapped = idMap.get(choiceCommand.choiceId);
				if (mapped) choiceCommand.choiceId = mapped;
				break;
			}
			case CommandType.Conditional: {
				const conditional = command as IConditionalCommand;
				remapCommands(
					conditional.thenCommands,
					idMap,
					shouldRegenerateIds,
				);
				remapCommands(
					conditional.elseCommands,
					idMap,
					shouldRegenerateIds,
				);
				break;
			}
			case CommandType.NestedChoice: {
				const nested = command as INestedChoiceCommand;
				nested.choice = remapChoiceTree(nested.choice, idMap);
				break;
			}
			default:
				break;
		}
	}
}

function replaceChoiceInTree(choices: IChoice[], replacement: IChoice): boolean {
	for (let i = 0; i < choices.length; i++) {
		const current = choices[i];
		if (current.id === replacement.id) {
			choices.splice(i, 1, replacement);
			return true;
		}
		if (current.type === "Multi") {
			const multi = current as IMultiChoice;
			if (multi.choices && replaceChoiceInTree(multi.choices, replacement)) {
				return true;
			}
		}
	}
	return false;
}

function insertUnderParent(
	choices: IChoice[],
	parentId: string,
	child: IChoice,
): boolean {
	for (const choice of choices) {
		if (choice.id === parentId && choice.type === "Multi") {
			insertIntoMulti(choice as IMultiChoice, child);
			return true;
		}
		if (choice.type === "Multi") {
			const multi = choice as IMultiChoice;
			if (multi.choices && insertUnderParent(multi.choices, parentId, child)) {
				return true;
			}
		}
	}
	return false;
}

function insertIntoMulti(parent: IMultiChoice, child: IChoice): void {
	if (!Array.isArray(parent.choices)) {
		parent.choices = [];
	}
	const idx = parent.choices.findIndex((choice) => choice.id === child.id);
	if (idx !== -1) {
		parent.choices.splice(idx, 1, child);
	} else {
		parent.choices.push(child);
	}
}

function findMultiByPath(
	rootChoices: IChoice[],
	path: string[],
): IMultiChoice | null {
	if (path.length === 0) return null;
	let currentChoices = rootChoices;
	let currentMulti: IMultiChoice | null = null;

	for (const segment of path) {
		const next = currentChoices.find(
			(choice) => choice.type === "Multi" && choice.name === segment,
		) as IMultiChoice | undefined;
		if (!next) return null;
		currentMulti = next;
		currentChoices = next.choices ?? [];
	}

	return currentMulti;
}

async function ensureParentFolders(app: App, filePath: string): Promise<void> {
	const lastSlash = filePath.lastIndexOf("/");
	if (lastSlash < 0) return;
	const folderPath = filePath.slice(0, lastSlash);
	if (!folderPath) return;

	const segments = folderPath.split("/").filter(Boolean);
	let current = "";
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const exists = await app.vault.adapter.exists(current);
		if (!exists) {
			await app.vault.createFolder(current);
		}
	}
}
