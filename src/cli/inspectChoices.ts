import type { CliData } from "obsidian";
import { ChoiceExecutor } from "../choiceExecutor";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { getWritePosition } from "../engine/captureAction";
import { checkTemplateSource } from "../engine/templateSource";
import { claimRefusal, RefusalError } from "../errors/RefusalError";
import { isTemplateChoice } from "../types/choices/choiceType";
import { deriveFolderMode } from "../gui/ChoiceBuilder/folderMode";
import { childChoicesOf, isChoiceLike, rootChoicesOf } from "../utils/choiceUtils";
import { collectChoiceRequirements, getUnresolvedRequirements, listDeferredMacroSteps } from "../preflight/collectChoiceRequirements";
import { analysePackagePreview, readQuickAddPackage } from "../services/packageImportService";
import { decodeAssetPreview, type AssetPreviewContent, type PackagePreview } from "../services/packagePreview";
import { describeChoice, extractVariables, isTruthy, resolveChoiceFromParams, RESERVED_CHECK_PARAMS, setExecutorVariables, toDetailedFieldSummary, toMissingFieldSummary } from "./params";

interface CliChoiceSummary {
	id: string;
	name: string;
	type: IChoice["type"];
	command: boolean;
	path: string;
	runnable: boolean;
	writes?: Record<string, string | boolean>;
}
const SUPPORTED_LIST_TYPES = new Set(["template", "capture", "macro", "multi"]);

/**
 * What a Template or Capture writes, read from its stored settings with the
 * same rules the choice builder and engines use, so a caller (a person or an
 * agent) can pick the right choice without opening it. Formats stay
 * unexpanded; `<ask>` marks a part QuickAdd asks for at run time.
 */
function describeWrites(choice: IChoice): CliChoiceSummary["writes"] {
	if (choice.type === "Capture") {
		const capture = choice as ICaptureChoice;
		const position = getWritePosition(capture);
		const writes: Record<string, string | boolean> = {
			target: capture.captureToActiveFile ? "<active file>" : capture.captureTo,
			position: position === "activeTop" ? "top" : position === "top" && capture.captureToActiveFile ? "cursor" : position,
		};
		if (position === "after") writes.line = capture.insertAfter.promptHeading ? "<ask>" : capture.insertAfter.after;
		if (position === "before") writes.line = capture.insertBefore?.before ?? "";
		if (capture.propertyCapture) {
			const property = capture.propertyCapture.property;
			writes.property = property.kind === "named" ? property.format : "<ask>";
		}
		writes.format = capture.format?.enabled ? capture.format.format : "{{VALUE}}";
		// Task and One entry per line don't apply to a property capture.
		if (!capture.propertyCapture) {
			if (capture.task) writes.task = true;
			if (capture.eachLine) writes.eachLine = true;
		}
		const create = capture.createFileIfItDoesntExist;
		if (create?.enabled && create.createWithTemplate && create.template) writes.createWithTemplate = create.template;
		return writes;
	}
	if (choice.type === "Template") {
		const template = choice as ITemplateChoice;
		// A list must not fail on one hand-edited choice, so read defensively.
		const folder = template.folder ?? { enabled: false, folders: [] };
		const mode = deriveFolderMode(folder);
		return {
			template: template.templatePath,
			folder:
				mode === "obsidian-default" ? "<default>" :
				mode === "active-file" ? "<active file's folder>" :
				mode === "specified" && folder.folders?.length === 1 && !folder.chooseFromSubfolders ? folder.folders[0] :
				"<ask>",
			fileName: template.fileNameFormat?.enabled ? template.fileNameFormat.format : "{{VALUE}}",
		};
	}
	return undefined;
}

function flattenChoices(
	choices: IChoice[],
	segments: string[] = [],
): CliChoiceSummary[] {
	const flattened: CliChoiceSummary[] = [];

	for (const choice of rootChoicesOf(choices)) {
		if (!isChoiceLike(choice)) continue;
		const pathSegments = [...segments, choice.name];
		const path = pathSegments.join(" / ");
		const isMulti = choice.type === "Multi";
		flattened.push({
			id: choice.id,
			name: choice.name,
			type: choice.type,
			command: choice.command,
			path,
			runnable: !isMulti,
			writes: describeWrites(choice),
		});

		if (isMulti) {
			flattened.push(...flattenChoices(childChoicesOf(choice), pathSegments));
		}
	}

	return flattened;
}

export function listChoicesHandler(plugin: QuickAdd, params: CliData) {
	const rawType = typeof params.type === "string" ? params.type.trim() : "";
	const type = rawType.toLowerCase();
	if (type && !SUPPORTED_LIST_TYPES.has(type)) {
		return { ok: false, error: `Invalid type filter '${rawType}'.` };
	}
	const choices = flattenChoices(plugin.settings.choices).filter((choice) =>
		(!type || choice.type.toLowerCase() === type) &&
		(!isTruthy(params.commands) || choice.command),
	);
	return { ok: true, count: choices.length, choices };
}

export async function checkChoiceHandler(
	plugin: QuickAdd,
	params: CliData,
) {
	const choice = resolveChoiceFromParams(plugin, params);
	if (choice.type === "Multi") {
		return {
			ok: false,

			error: "Multi choices are interactive and cannot be checked via CLI.",
			choice: describeChoice(choice),
		};
	}

	const variables = extractVariables(params, RESERVED_CHECK_PARAMS);
	const choiceExecutor = new ChoiceExecutor(
		plugin.app,
		plugin,
	);
	setExecutorVariables(choiceExecutor, variables);

	let requirements;
	try {
		// A template that is not there is the one thing to report: nothing is asked.
		if (isTemplateChoice(choice)) checkTemplateSource(plugin.app, choice);
		requirements = await collectChoiceRequirements(
			plugin.app,
			plugin,
			choiceExecutor,
			choice,
		);
	} catch (error) {
		if (!(error instanceof RefusalError)) throw error;
		return { ok: false, error: claimRefusal(error, choice.name), choice: describeChoice(choice) };
	}
	const unresolved = getUnresolvedRequirements(
		requirements,
		choiceExecutor.variables,
	);
	const summarize = isTruthy(params.fields)
		? toDetailedFieldSummary
		: toMissingFieldSummary;

	return {
		ok: unresolved.length === 0,

		choice: describeChoice(choice),
		requiredInputCount: requirements.length,
		missingInputCount: unresolved.length,
		missing: unresolved.map(summarize),
		missingFlags: unresolved.map(
			(requirement) => `value-${requirement.id}=<value>`,
		),
		...(choice.type === "Macro"
			? { deferred: listDeferredMacroSteps(plugin, choice as IMacroChoice, choiceExecutor.variables.get("value")) }
			: {}),
	};
}

export async function previewPackageHandler(
	plugin: QuickAdd,
	params: CliData,
) {
	const path =
		typeof params.path === "string" ? params.path.trim() : "";
	if (!path) {
		return {
			ok: false,

			error: "Missing package path. Provide path=<vault-path>.",
		};
	}

	const { pkg } = await readQuickAddPackage(plugin.app, path);
	const preview = await analysePackagePreview(
		plugin.app,
		plugin.settings.choices,
		pkg,
	);

	const response: { ok: boolean; preview: PackagePreview; contents?: Array<{ path: string } & AssetPreviewContent> } = {
		ok: true,

		preview,
	};

	if (isTruthy(params.decode)) {
		response.contents = preview.files.map((file) => ({
			path: file.originalPath,
			...decodeAssetPreview(pkg, file.originalPath),
		}));
	}

	return response;
}
