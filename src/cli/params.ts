import type { App, CliData, CliFlags, TFile } from "obsidian";
import type { AppProvider, ChoiceLookup } from "../types/pluginContext";
import type IChoice from "../types/choices/IChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { FieldRequirement } from "../preflight/RequirementCollector";
import { QA_INTERNAL_DATE_ORIGIN } from "../constants";
import { normalizeVaultPath } from "../utils/pathUtils";
import { describeCurrentNoteUse } from "./currentNoteUse";

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
const CURRENT_FLAG = {
	value: "<vault-path|none>",
	description: "Current note for the run: a vault path, or none (default: the active tab)",
};

export const RUN_FLAGS: CliFlags = {
	...SELECTOR_FLAGS,
	vars: VARS_FLAG,
	ui: UI_FLAG,
	verify: {
		description: "Report the verified outcome for Template/Capture choices (file path and effect on success, honest failure when the engine swallows an error)",
	},
	date: DATE_FLAG,
	current: CURRENT_FLAG,
};
export const LIST_FLAGS: CliFlags = {
	type: { value: "<Template|Capture|Macro|Multi>", description: "Filter by choice type" },
	commands: { description: "Only include command-enabled choices" },
};
export const SUGGEST_FLAGS: CliFlags = {
	kind: { value: "<links|tags>", description: "Which suggestions to list" },
	source: { value: "<vault-path>", description: "Note the link will be inserted in (link text follows the vault's link format from there)" },
};
export const RUN_TEMPLATE_FLAGS: CliFlags = {
	path: { value: "<vault-path>", description: "Path to a template file in the vault" },
	vars: VARS_FLAG,
	ui: UI_FLAG,
	date: DATE_FLAG,
	current: CURRENT_FLAG,
};
export const CHECK_FLAGS: CliFlags = {
	...SELECTOR_FLAGS,
	vars: VARS_FLAG,
	fields: { description: "Include full field metadata (options, defaults, widget config)" },
	date: DATE_FLAG,
	current: CURRENT_FLAG,
};
export const INTERACTIVE_FLAGS: CliFlags = {
	...SELECTOR_FLAGS,
	vars: { value: "<json>", description: "Variables object as JSON (pre-seeded inputs)" },
	date: DATE_FLAG,
	current: CURRENT_FLAG,
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

const TRUE_FLAG_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_FLAG_VALUES = new Set(["false", "0", "no", "off"]);

/** A switch flag (`ui`, `verify`, ...): on for a true-ish value, off otherwise. */
export function isTruthy(value: string | undefined): boolean {
	return value !== undefined && TRUE_FLAG_VALUES.has(value.toLowerCase());
}

/**
 * A flag that overrides a setting: undefined when absent or empty (the setting
 * applies), else true or false. Any other value throws, naming the flag.
 */
export function parseBooleanFlag(name: string, value: string | undefined): boolean | undefined {
	if (value === undefined || value === "") return undefined;
	const normalized = value.toLowerCase();
	if (TRUE_FLAG_VALUES.has(normalized)) return true;
	if (FALSE_FLAG_VALUES.has(normalized)) return false;
	throw new Error(`Invalid ${name}: ${value}. Use true or false.`);
}

const VALUE_PARAM_PREFIX = "value-";

/**
 * The variable a `value-<name>` parameter sets ("" for a bare `value-`, which
 * names none), or undefined for any other parameter. Shared by the CLI and the
 * `obsidian://quickadd` URI so both read the convention the same way.
 */
export function valueParameterName(key: string): string | undefined {
	return key.startsWith(VALUE_PARAM_PREFIX) ? key.slice(VALUE_PARAM_PREFIX.length) : undefined;
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
		const variableName = valueParameterName(key);
		if (variableName !== undefined) {
			if (variableName) variables[variableName] = value;
			continue;
		}

		if (reservedKeys.has(key)) continue;
		variables[key] = value;
	}

	return variables;
}

/**
 * The `current=` flag: the note the run treats as current. `undefined` when
 * absent (the active tab), `null` for `none`, else the vault file at the path,
 * or at the path with `.md` added when nothing is at the path itself. A path
 * with no note throws, so nothing runs for a mistyped one.
 */
export function resolveCurrentNote(app: App, params: CliData): TFile | null | undefined {
	if (typeof params.current !== "string") return undefined;
	const value = params.current.trim();
	if (value === "none") return null;
	const path = normalizeVaultPath(value);
	const file = app.vault.getFileByPath(path) ?? app.vault.getFileByPath(`${path}.md`);
	if (!file) throw new Error(`No note at '${value}'.`);
	return file;
}

export function resolveChoiceFromParams(plugin: Pick<ChoiceLookup, "getChoiceById" | "getChoiceByName">, params: CliData): IChoice {
	if (typeof params.id === "string" && params.id.trim().length > 0) {
		return plugin.getChoiceById(params.id);
	}

	if (typeof params.choice === "string" && params.choice.trim().length > 0) {
		return plugin.getChoiceByName(params.choice);
	}

	throw new Error("Missing choice selector. Provide either choice=<name> or id=<id>");
}

/** The flag that answers a missing input: the run's day is `date=`, anything else `value-<id>=`. */
export function missingFlagFor({ id }: Pick<FieldRequirement, "id">): string {
	return id === QA_INTERNAL_DATE_ORIGIN ? "date=<when>" : `${VALUE_PARAM_PREFIX}${id}=<value>`;
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

export async function describeChoice(plugin: AppProvider, choice: IChoice) {
	return {
		id: choice.id,
		name: choice.name,
		type: choice.type,
		currentNote: await describeCurrentNoteUse(plugin, choice),
	};
}
