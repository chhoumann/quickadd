import type { App } from "obsidian";
import { TFile } from "obsidian";
import { getActiveMarkdownEditorView } from "src/utils/activeMarkdownEditor";
import { MAX_TEMPLATE_INCLUSION_DEPTH } from "src/formatters/formatter";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import {
	QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
	TEMPLATE_REGEX,
} from "src/constants";
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
	getMarkdownFilesMatchingFilter,
	getMarkdownFilesWithTag,
	getMarkdownFilesWithProperty,
	getTemplateFile,
	getUserScript,
	isFolder,
} from "src/utilityObsidian";
import { log } from "src/logger/logManager";
import {
	getUserScriptPreloadKey,
	isUserScriptLoadError,
} from "src/utils/userScript";
import { hasTemplatePathSyntax } from "src/utils/templatePathSyntax";
import {
	classifyCaptureTargetScope,
	markdownFilePathForFolderCandidate,
} from "src/engine/helpers/captureTargetScope";
import { orderFilesForPicker } from "src/utils/fileOrdering";
import { buildFileDisplayLabels } from "src/utils/fileSyntax";
import { buildPickerOrderingDeps } from "src/utils/pickerOrderingDeps";
import { resolveExistingVariableKey } from "src/utils/valueSyntax";
import {
	RequirementCollector,
	type FieldRequirement,
	type FieldType,
} from "./RequirementCollector";
import type { NumericInputConfig, SliderConfig } from "src/utils/valueSyntax";

interface CollectChoiceRequirementsOptions {
	seedCaptureSelectionAsValue?: boolean;
	/**
	 * When provided, user-script modules loaded to read `quickadd.inputs` are
	 * cached here (keyed via `getUserScriptPreloadKey`: `command.path ??
	 * command.id` plus any `::` member-drill suffix) and reused across
	 * collection passes. Loading a CommonJS user script EXECUTES its top-level
	 * code, so without this cache a single trigger runs every script's module
	 * body twice: once here for introspection and once in MacroChoiceEngine.
	 * The engine consumes these entries instead of re-loading (delete-on-use).
	 */
	preloadedUserScripts?: Map<string, unknown>;
}

const VALID_FIELD_TYPES: FieldType[] = [
	"text",
	"number",
	"textarea",
	"dropdown",
	"slider",
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
	const numericConfig = parseNumericConfig(value.numericConfig);
	const sliderConfig = parseSliderConfig(value.sliderConfig);
	const fieldType = type === "slider" && !sliderConfig ? "number" : type;

	return {
		id,
		label: typeof value.label === "string" ? value.label : id,
		type: fieldType,
		placeholder:
			typeof value.placeholder === "string" ? value.placeholder : undefined,
		defaultValue:
			typeof value.defaultValue === "string" ? value.defaultValue : undefined,
		numericConfig: sliderConfig ?? numericConfig,
		sliderConfig,
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

function parseNumericConfig(value: unknown): NumericInputConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const min = typeof raw.min === "number" && Number.isFinite(raw.min)
		? raw.min
		: undefined;
	const max = typeof raw.max === "number" && Number.isFinite(raw.max)
		? raw.max
		: undefined;
	const step = typeof raw.step === "number" && Number.isFinite(raw.step) && raw.step > 0
		? raw.step
		: undefined;
	if (min !== undefined && max !== undefined && max < min) {
		return step === undefined ? undefined : { step };
	}
	const config: NumericInputConfig = {};
	if (min !== undefined) config.min = min;
	if (max !== undefined) config.max = max;
	if (step !== undefined) config.step = step;
	return Object.keys(config).length > 0 ? config : undefined;
}

function parseSliderConfig(value: unknown): SliderConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const min = typeof raw.min === "number" ? raw.min : undefined;
	const max = typeof raw.max === "number" ? raw.max : undefined;
	const step = raw.step === undefined
		? 1
		: typeof raw.step === "number"
			? raw.step
			: undefined;
	if (
		min === undefined ||
		max === undefined ||
		step === undefined ||
		!Number.isFinite(min) ||
		!Number.isFinite(max) ||
		!Number.isFinite(step) ||
		max <= min ||
		step <= 0
	) {
		return undefined;
	}
	return { min, max, step };
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

function getRawTemplateRefs(content: string): Set<string> {
	const refs = new Set<string>();
	const re = new RegExp(TEMPLATE_REGEX.source, "gi");
	let match: RegExpExecArray | null;
	while ((match = re.exec(content)) !== null) {
		if (match[1]) refs.add(match[1]);
	}
	return refs;
}

async function scanContentWithTemplateIncludes(
	app: App,
	collector: RequirementCollector,
	content: string,
	templateStack = new Set<string>(),
	depth = 0,
	pathContext = false,
): Promise<void> {
	// templatesToScan is a queue for this content scan. Clear it before and
	// after scanning so refs from unrelated strings are not drained together.
	const rawTemplateRefs = getRawTemplateRefs(content);
	collector.templatesToScan.clear();
	await collector.scanString(content, pathContext);
	const nested = [...collector.templatesToScan].filter((ref) =>
		rawTemplateRefs.has(ref),
	);
	collector.templatesToScan.clear();

	if (depth >= MAX_TEMPLATE_INCLUSION_DEPTH) return;

	for (const ref of nested) {
		if (templateStack.has(ref)) continue;
		// Skip a template already fully scanned at an equal-or-shallower depth:
		// same content, and its children were explored at least as deep, so a
		// re-scan can only repeat work (the per-path `templateStack` alone lets
		// a dense DAG re-scan each template once per PATH - up to
		// branching^depth invocations). A ref first seen NEAR the depth cap is
		// re-scanned if met again shallower, so the memo never truncates a
		// subtree the old walk would have explored.
		// The memo is keyed per CONTEXT: a template first scanned from content
		// must be re-scanned when later reached from a path string, or its
		// variables would keep image paste despite feeding a path (#1484).
		const memoKey = `${pathContext ? "path" : "content"}:${ref}`;
		const scannedDepth = collector.scannedTemplateRefDepths.get(memoKey);
		if (scannedDepth !== undefined && scannedDepth <= depth) continue;
		collector.scannedTemplateRefDepths.set(memoKey, depth);
		templateStack.add(ref);
		try {
			await scanContentWithTemplateIncludes(
				app,
				collector,
				await readTemplate(app, ref),
				templateStack,
				depth + 1,
				// A template included FROM a path string is spliced into that
				// path at runtime, so its tokens are path context too.
				pathContext,
			);
		} finally {
			templateStack.delete(ref);
		}
	}
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
	// The template PATH is path context; the template BODY below is content.
	await collector.scanString(templatePath, true);

	if (hasTemplatePathSyntax(templatePath)) {
		log.logMessage(
			`Preflight: template path "${templatePath}" uses format syntax; its body's prompts are collected at run time, not in the one-page form.`,
		);
		return;
	}

	await scanContentWithTemplateIncludes(
		app,
		collector,
		await readTemplate(app, templatePath),
		new Set([templatePath]),
	);
}

async function collectForTemplateChoice(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: ITemplateChoice,
): Promise<RequirementCollector> {
	const collector = new RequirementCollector(app, plugin, choiceExecutor);

	if (choice.fileNameFormat?.enabled) {
		await scanContentWithTemplateIncludes(
			app,
			collector,
			choice.fileNameFormat.format,
			undefined,
			0,
			true, // file name = path context
		);
	}

	if (choice.folder?.enabled) {
		for (const folder of choice.folder.folders ?? []) {
			await scanContentWithTemplateIncludes(
				app,
				collector,
				folder,
				undefined,
				0,
				true, // folder = path context
			);
		}
	}

	if (choice.templatePath) {
		await scanTemplateSource(app, collector, choice.templatePath);
	}

	return collector;
}

function getEditorSelection(app: App): string {
	const activeView = getActiveMarkdownEditorView(app);
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

	await scanContentWithTemplateIncludes(
		app,
		collector,
		choice.captureTo,
		undefined,
		0,
		true, // capture target = path context (scanned BEFORE content so a dual-use {{VALUE}} is marked)
	);

	if (choice.format?.enabled) {
		await scanContentWithTemplateIncludes(
			app,
			collector,
			choice.format.format,
		);
	}

	if (choice.insertAfter?.enabled && !choice.insertAfter.promptHeading) {
		await scanContentWithTemplateIncludes(
			app,
			collector,
			choice.insertAfter.after,
			undefined,
			0,
			true, // location target = path context (an embed link can never match a line)
		);
	}

	if (choice.insertBefore?.enabled) {
		await scanContentWithTemplateIncludes(
			app,
			collector,
			choice.insertBefore.before,
			undefined,
			0,
			true, // location target = path context
		);
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

	// One classifier (shared with CaptureChoiceEngine) decides whether "Capture to"
	// needs a runtime file pick and, if so, the scope. Keeping the engine and this
	// collector on the same classification guarantees a preselected pick is honoured
	// exactly when it was legitimately collected, never silently dropped or hijacked.
	const captureScope = classifyCaptureTargetScope(
		{
			isFolder: (path) => isFolder(app, path),
			markdownFileExists: (path) =>
				app.vault.getAbstractFileByPath(
					markdownFilePathForFolderCandidate(path),
				) instanceof TFile,
		},
		choice.captureTo ?? "",
		choice.captureToActiveFile,
	);

	if (captureScope) {
		let files: TFile[] = [];
		switch (captureScope.kind) {
			case "property":
				files = getMarkdownFilesWithProperty(
					app,
					captureScope.field,
					captureScope.value,
					captureScope.filter,
				);
				break;
			case "filter":
				files = getMarkdownFilesMatchingFilter(app, captureScope.filter);
				break;
			case "tag":
				files = getMarkdownFilesWithTag(app, captureScope.tag);
				break;
			case "folder":
				files = getMarkdownFilesInFolder(app, captureScope.folderPathSlash);
				break;
		}

		const orderedFiles = orderFilesForPicker(
			files,
			buildPickerOrderingDeps(app),
		);
		const options = orderedFiles.map((file) => file.path);
		const displayOptions = buildFileDisplayLabels(
			orderedFiles,
			(file) => app.metadataCache?.getFileCache(file) ?? null,
		);
		const allowCreateTarget =
			choice.createFileIfItDoesntExist?.enabled ?? false;
		if (options.length === 0 && allowCreateTarget) {
			collector.requirements.set(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, {
				id: QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
				label: "Select capture target file",
				type: "file-picker",
				source: "collected",
				options,
				displayOptions,
				runtimeOnly: true,
				placeholder: "Type a new note name in the capture target picker",
			});
		} else {
			collector.requirements.set(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, {
				id: QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
				label: "Select capture target file",
				type: "dropdown",
				options,
				displayOptions,
				placeholder: options.length
					? undefined
					: "No files found in target scope",
			});
		}
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
	preloadedUserScripts?: Map<string, unknown>,
): Promise<FieldRequirement[]> {
	const requirements: FieldRequirement[] = [];
	const commands: ICommand[] = choice?.macro?.commands ?? [];

	for (const command of commands) {
		if (command?.type !== CommandType.UserScript) continue;
		const userScriptCommand = command as IUserScript;
		try {
			// Reuse an already-loaded module (loading executes the script's
			// top-level code); cache what we load so the runtime engine consumes
			// this execution instead of running the module body a second time.
			// The key is member-aware (path + `::` drill) because getUserScript
			// returns the drilled export.
			const cacheKey = getUserScriptPreloadKey(userScriptCommand);
			let exported =
				cacheKey !== undefined
					? preloadedUserScripts?.get(cacheKey)
					: undefined;
			if (exported === undefined) {
				exported = await getUserScript(userScriptCommand, app, {
					reportLoadErrors: false,
				});
				if (cacheKey !== undefined && exported !== undefined) {
					preloadedUserScripts?.set(cacheKey, exported);
				}
			}
			const scriptInputs = getQuickAddScriptInputs(exported);
			for (const input of scriptInputs) {
				const requirement = toFieldRequirement(input);
				if (requirement) requirements.push(requirement);
			}
		} catch (error) {
			const scriptPath = userScriptCommand.path ?? userScriptCommand.id;
			const message =
				error instanceof Error ? error.message : String(error);
			if (isUserScriptLoadError(error)) {
				log.logMessage(
					`QuickAdd preflight could not inspect user script '${scriptPath}': ${message}`,
				);
				continue;
			}
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
			options?.preloadedUserScripts,
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
	return requirements.filter((requirement) => {
		const resolvedKey = resolveExistingVariableKey(variables, requirement.id);
		// A variable explicitly set to null is unresolved (the documented rule is
		// "missing or null"); resolveExistingVariableKey only rejects undefined,
		// so re-check the resolved value here.
		if (!resolvedKey) return true;
		return variables.get(resolvedKey) == null;
	});
}
