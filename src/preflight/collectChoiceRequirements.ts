import type { App, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "src/constants";
import type QuickAdd from "src/main";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IChoice from "src/types/choices/IChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { ICommand } from "src/types/macros/ICommand";
import type { IUserScript } from "src/types/macros/IUserScript";
import {
	getMarkdownFilesInFolder,
	getMarkdownFilesWithTag,
	getMarkdownFilesWithProperty,
	getTemplateFile,
	getUserScript,
	isFolder,
} from "src/utilityObsidian";
import { log } from "src/logger/logManager";
import { hasTemplatePathSyntax } from "src/utils/templatePathSyntax";
import { parsePropertyTarget } from "src/utils/propertyTarget";
import { orderFilesForPicker } from "src/utils/fileOrdering";
import { buildPickerOrderingDeps } from "src/utils/pickerOrderingDeps";
import { resolveExistingVariableKey } from "src/utils/valueSyntax";
import {
	RequirementCollector,
	type FieldRequirement,
	type FieldType,
} from "./RequirementCollector";

interface CollectChoiceRequirementsOptions {
	seedCaptureSelectionAsValue?: boolean;
}

const VALID_FIELD_TYPES: FieldType[] = [
	"text",
	"textarea",
	"dropdown",
	"date",
	"field-suggest",
	"file-picker",
	"suggester",
];

function isFieldType(value: unknown): value is FieldType {
	return (
		typeof value === "string" &&
		VALID_FIELD_TYPES.includes(value as FieldType)
	);
}

function toFieldRequirement(input: unknown): FieldRequirement | null {
	if (!input || typeof input !== "object") return null;

	const value = input as Record<string, unknown>;
	const id = value.id;
	const type = value.type;
	if (typeof id !== "string" || !isFieldType(type)) return null;

	return {
		id,
		label: typeof value.label === "string" ? value.label : id,
		type,
		placeholder:
			typeof value.placeholder === "string" ? value.placeholder : undefined,
		defaultValue:
			typeof value.defaultValue === "string" ? value.defaultValue : undefined,
		options: Array.isArray(value.options)
			? value.options.filter((entry): entry is string => typeof entry === "string")
			: undefined,
		dateFormat:
			typeof value.dateFormat === "string" ? value.dateFormat : undefined,
		description:
			typeof value.description === "string" ? value.description : undefined,
		optional: typeof value.optional === "boolean" ? value.optional : undefined,
		source: "script",
	};
}

function getQuickAddScriptInputs(userScript: unknown): unknown[] {
	const readInputs = (value: unknown): unknown[] => {
		if (
			!value ||
			(typeof value !== "object" && typeof value !== "function")
		) {
			return [];
		}
		const quickadd = (value as { quickadd?: unknown }).quickadd;
		if (!quickadd || typeof quickadd !== "object") return [];
		const inputs = (quickadd as { inputs?: unknown }).inputs;
		return Array.isArray(inputs) ? inputs : [];
	};

	if (typeof userScript === "function") {
		return readInputs(userScript as { quickadd?: unknown });
	}

	return readInputs(userScript);
}

async function readTemplate(app: App, path: string): Promise<string> {
	const file = getTemplateFile(app, path);
	return file ? await app.vault.cachedRead(file) : "";
}

/**
 * Collects requirements from a template *source* path and (when resolvable) its
 * body. Shared by Template choices and Capture "create with template" so both
 * stay in sync (issue #620):
 *  - Always scans the path string itself, so tokens IN the path (e.g.
 *    `Templates/{{value:type}} Template.md`) are collected up front.
 *  - If the path uses format syntax, the body can't be pre-scanned (the path
 *    depends on the very answers we're collecting); those prompts surface at run
 *    time. Logged so it isn't a silent gap.
 *  - Otherwise walks the literal template body (and nested {{TEMPLATE:}}).
 */
async function scanTemplateSource(
	app: App,
	collector: RequirementCollector,
	templatePath: string,
): Promise<void> {
	await collector.scanString(templatePath);

	if (hasTemplatePathSyntax(templatePath)) {
		log.logMessage(
			`Preflight: template path "${templatePath}" uses format syntax; its body's prompts are collected at run time, not in the one-page form.`,
		);
		return;
	}

	const visited = new Set<string>();
	const walk = async (path: string) => {
		if (visited.has(path)) return;
		visited.add(path);
		const content = await readTemplate(app, path);
		await collector.scanString(content);
		// Snapshot and clear the shared discovery set BEFORE recursing: a nested
		// walk() runs scanString again, which would otherwise mutate (and then
		// clear) the very set we're iterating, dropping sibling/grandchild
		// templates from the scan.
		const nested = [...collector.templatesToScan];
		collector.templatesToScan.clear();
		for (const ref of nested) {
			if (!visited.has(ref)) await walk(ref);
		}
	};
	await walk(templatePath);
}

async function collectForTemplateChoice(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: ITemplateChoice,
): Promise<RequirementCollector> {
	const collector = new RequirementCollector(app, plugin, choiceExecutor);

	if (choice.fileNameFormat?.enabled) {
		await collector.scanString(choice.fileNameFormat.format);
	}

	if (choice.folder?.enabled) {
		for (const folder of choice.folder.folders ?? []) {
			await collector.scanString(folder);
		}
	}

	if (choice.templatePath) {
		await scanTemplateSource(app, collector, choice.templatePath);
	}

	return collector;
}

function getEditorSelection(app: App): string {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView) return "";
	return activeView.editor.getSelection();
}

async function collectForCaptureChoice(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: ICaptureChoice,
	seedCaptureSelectionAsValue: boolean,
): Promise<RequirementCollector> {
	const collector = new RequirementCollector(app, plugin, choiceExecutor);

	await collector.scanString(choice.captureTo);

	if (choice.format?.enabled) {
		await collector.scanString(choice.format.format);
	}

	// Capture's "create file if it doesn't exist → with template" runs through
	// SingleTemplateEngine, which resolves format tokens in the template path
	// (issue #620). Mirror the Template-choice preflight so the one-page form /
	// CLI collect the path's (and, for a literal path, the body's) inputs.
	const createWithTemplate = choice.createFileIfItDoesntExist;
	if (
		createWithTemplate?.enabled &&
		createWithTemplate.createWithTemplate &&
		createWithTemplate.template
	) {
		await scanTemplateSource(app, collector, createWithTemplate.template);
	}

	const formattedTarget = choice.captureTo?.trim() ?? "";
	const normalizedTarget = formattedTarget.replace(/^\/+/, "");
	// A `property:` target whose field/value carries a format token can only be
	// resolved at run time (mirrors the tokenized-file-path case), so skip the
	// preflight dropdown for it rather than forcing a dead "no files" picker.
	const propertyTarget =
		!hasTemplatePathSyntax(normalizedTarget)
			? parsePropertyTarget(normalizedTarget)
			: null;
	const isPropertyTarget = !!propertyTarget && !!propertyTarget.field;
	const isTagTarget = !isPropertyTarget && normalizedTarget.startsWith("#");
	const trimmedPath = normalizedTarget.replace(/\/$|\.md$/g, "");
	const isFolderTarget =
		!isTagTarget &&
		!isPropertyTarget &&
		(normalizedTarget === "" || isFolder(app, trimmedPath));
	const looksLikeFolderBySuffix =
		!isPropertyTarget && normalizedTarget.endsWith("/");

	if (
		!choice.captureToActiveFile &&
		(isPropertyTarget ||
			isTagTarget ||
			isFolderTarget ||
			looksLikeFolderBySuffix)
	) {
		let files: TFile[] = [];
		if (isPropertyTarget && propertyTarget) {
			files = getMarkdownFilesWithProperty(
				app,
				propertyTarget.field,
				propertyTarget.value,
				propertyTarget.filter,
			);
		} else if (isTagTarget) {
			files = getMarkdownFilesWithTag(app, normalizedTarget);
		} else {
			const folder = normalizedTarget.replace(/(?:\/|\.md)+$/g, "");
			const base =
				folder === "" ? "" : folder.endsWith("/") ? folder : `${folder}/`;
			files = getMarkdownFilesInFolder(app, base);
		}

		const options = orderFilesForPicker(
			files,
			buildPickerOrderingDeps(app),
		).map((file) => file.path);
		collector.requirements.set(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, {
			id: QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			label: "Select capture target file",
			type: "dropdown",
			options,
			placeholder: options.length
				? undefined
				: "No files found in target scope",
		});
	}

	if (seedCaptureSelectionAsValue) {
		const selectionOverride = choice.useSelectionAsCaptureValue;
		const globalSelectionAsValue =
			plugin.settings.useSelectionAsCaptureValue ?? true;
		const useSelectionAsCaptureValue =
			typeof selectionOverride === "boolean"
				? selectionOverride
				: globalSelectionAsValue;
		if (useSelectionAsCaptureValue) {
			const existingValue = choiceExecutor.variables.get("value");
			if (existingValue === undefined || existingValue === null) {
				const selectedText = getEditorSelection(app);
				if (selectedText.trim().length > 0) {
					choiceExecutor.variables.set("value", selectedText);
				}
			}
		}
	}

	return collector;
}

async function collectMacroScriptRequirements(
	app: App,
	choice: IMacroChoice,
): Promise<FieldRequirement[]> {
	const requirements: FieldRequirement[] = [];
	const commands: ICommand[] = choice?.macro?.commands ?? [];

	for (const command of commands) {
		if (command?.type !== CommandType.UserScript) continue;
		const userScriptCommand = command as IUserScript;
		try {
			const exported = await getUserScript(userScriptCommand, app);
			const scriptInputs = getQuickAddScriptInputs(exported);
			for (const input of scriptInputs) {
				const requirement = toFieldRequirement(input);
				if (requirement) requirements.push(requirement);
			}
		} catch (error) {
			const scriptPath = userScriptCommand.path ?? userScriptCommand.id;
			const message =
				error instanceof Error ? error.message : String(error);
			log.logWarning(
				`Preflight could not inspect user script '${scriptPath}': ${message}`,
			);
		}
	}

	return requirements;
}

export async function collectChoiceRequirements(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: IChoice,
	options?: CollectChoiceRequirementsOptions,
): Promise<FieldRequirement[]> {
	let collector: RequirementCollector | null = null;
	let scriptRequirements: FieldRequirement[] = [];

	if (choice.type === "Template") {
		collector = await collectForTemplateChoice(
			app,
			plugin,
			choiceExecutor,
			choice as ITemplateChoice,
		);
	} else if (choice.type === "Capture") {
		collector = await collectForCaptureChoice(
			app,
			plugin,
			choiceExecutor,
			choice as ICaptureChoice,
			options?.seedCaptureSelectionAsValue ?? false,
		);
	} else if (choice.type === "Macro") {
		scriptRequirements = await collectMacroScriptRequirements(
			app,
			choice as IMacroChoice,
		);
	} else {
		return [];
	}

	const mergedMap = new Map<string, FieldRequirement>();
	for (const requirement of collector
		? Array.from(collector.requirements.values())
		: []) {
		mergedMap.set(requirement.id, requirement);
	}
	for (const requirement of scriptRequirements) {
		if (!mergedMap.has(requirement.id)) {
			mergedMap.set(requirement.id, requirement);
		}
	}

	return Array.from(mergedMap.values());
}

export function getUnresolvedRequirements(
	requirements: FieldRequirement[],
	variables: Map<string, unknown>,
): FieldRequirement[] {
	return requirements.filter(
		(requirement) => !resolveExistingVariableKey(variables, requirement.id),
	);
}
