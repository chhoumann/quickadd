import type { CliData } from "obsidian";
import { ChoiceExecutor } from "../choiceExecutor";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
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
}
const SUPPORTED_LIST_TYPES = new Set(["template", "capture", "macro", "multi"]);

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

	const requirements = await collectChoiceRequirements(
		plugin.app,
		plugin,
		choiceExecutor,
		choice,
	);
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

