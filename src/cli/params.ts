import type { CliData, CliFlags } from "obsidian";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { FieldRequirement } from "../preflight/RequirementCollector";

const SELECTOR_FLAGS: CliFlags = {
	choice: { value: "<name>", description: "Choice name" },
	id: { value: "<id>", description: "Choice id" },
};
const VARS_FLAG = { value: "<json>", description: "Variables object as JSON" };
const UI_FLAG = { description: "Allow interactive prompts" };
const DATE_FLAG = {
	value: "<when>",
	description: "Day for {{DATE}} (YYYY-MM-DD, last week, last friday, ask, @date:ISO)",
};

export const RUN_FLAGS: CliFlags = {
	...SELECTOR_FLAGS,
	vars: VARS_FLAG,
	ui: UI_FLAG,
	verify: {
		description: "Report the verified outcome for Template/Capture choices (file path and effect on success, honest failure when the engine swallows an error)",
	},
	date: DATE_FLAG,
};
export const LIST_FLAGS: CliFlags = {
	type: { value: "<Template|Capture|Macro|Multi>", description: "Filter by choice type" },
	commands: { description: "Only include command-enabled choices" },
};
export const RUN_TEMPLATE_FLAGS: CliFlags = {
	path: { value: "<vault-path>", description: "Path to a template file in the vault" },
	vars: VARS_FLAG,
	ui: UI_FLAG,
	date: DATE_FLAG,
};
export const CHECK_FLAGS: CliFlags = {
	...SELECTOR_FLAGS,
	vars: VARS_FLAG,
	fields: { description: "Include full field metadata (options, defaults, widget config)" },
};
export const INTERACTIVE_FLAGS: CliFlags = {
	...SELECTOR_FLAGS,
	vars: { value: "<json>", description: "Variables object as JSON (pre-seeded inputs)" },
};
export const PREVIEW_FLAGS: CliFlags = {
	path: { value: "<vault-path>", description: "Path to a .quickadd.json package file in the vault" },
	decode: { description: "Inline decoded contents for each bundled file" },
};

// Flag names are reserved; value-<name> and vars JSON can still supply those variables.
export const RESERVED_RUN_PARAMS = new Set(Object.keys(RUN_FLAGS));
export const RESERVED_RUN_TEMPLATE_PARAMS = new Set(Object.keys(RUN_TEMPLATE_FLAGS));
export const RESERVED_CHECK_PARAMS = new Set(Object.keys(CHECK_FLAGS));
export const RESERVED_INTERACTIVE_PARAMS = new Set(Object.keys(INTERACTIVE_FLAGS));

export function isTruthy(value: string | undefined): boolean {
	if (value === undefined) return false;
	const normalized = value.toLowerCase();
	return (
		normalized === "true" ||
		normalized === "1" ||
		normalized === "yes" ||
		normalized === "on"
	);
}

function parseVarsJson(value: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(
			`Invalid vars JSON: ${error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Invalid vars JSON: expected an object");
	}

	return parsed as Record<string, unknown>;
}

export function extractVariables(
	params: CliData,
	reservedKeys: Set<string>,
): Record<string, unknown> {
	const variables: Record<string, unknown> = {};

	if (typeof params.vars === "string") {
		Object.assign(variables, parseVarsJson(params.vars));
	}

	for (const [key, value] of Object.entries(params)) {
		if (key.startsWith("value-")) {
			const variableName = key.slice(6);
			if (variableName) variables[variableName] = value;
			continue;
		}

		if (reservedKeys.has(key)) continue;
		variables[key] = value;
	}

	return variables;
}

export function resolveChoiceFromParams(plugin: QuickAdd, params: CliData): IChoice {
	if (typeof params.id === "string" && params.id.trim().length > 0) {
		return plugin.getChoiceById(params.id);
	}

	if (typeof params.choice === "string" && params.choice.trim().length > 0) {
		return plugin.getChoiceByName(params.choice);
	}

	throw new Error("Missing choice selector. Provide either choice=<name> or id=<id>");
}

export function toMissingFieldSummary(requirement: FieldRequirement) {
	return {
		id: requirement.id,
		label: requirement.label,
		type: requirement.type,
		source: requirement.source ?? "collected",
		placeholder: requirement.placeholder,
		defaultValue: requirement.defaultValue,
		description: requirement.description,
		optionCount: requirement.options?.length ?? 0,
	};
}

export function toDetailedFieldSummary(requirement: FieldRequirement) {
	return {
		...toMissingFieldSummary(requirement),
		options: requirement.options,
		displayOptions: requirement.displayOptions,
		dateFormat: requirement.dateFormat,
		withTime: requirement.withTime,
		optional: requirement.optional,
		runtimeOnly: requirement.runtimeOnly,
		multiEmit: requirement.multiEmit,
		filters: requirement.filters,
		numericConfig: requirement.numericConfig,
		sliderConfig: requirement.sliderConfig,
		suggesterConfig: requirement.suggesterConfig,
	};
}

export function setExecutorVariables(
	choiceExecutor: IChoiceExecutor,
	variables: Record<string, unknown>,
) {
	for (const [key, value] of Object.entries(variables)) {
		choiceExecutor.variables.set(key, value);
	}
}

export function describeChoice(choice: IChoice) {
	return {
		id: choice.id,
		name: choice.name,
		type: choice.type,
	};
}
