import type { CliData, CliFlags } from "obsidian";
import { ChoiceExecutor } from "../choiceExecutor";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import {
	collectChoiceRequirements,
	getUnresolvedRequirements,
} from "../preflight/collectChoiceRequirements";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";

type ChoiceType = IChoice["type"];

interface CliChoiceSummary {
	id: string;
	name: string;
	type: ChoiceType;
	command: boolean;
	path: string;
	runnable: boolean;
}

interface CliResponse {
	ok: boolean;
	command: string;
	[key: string]: unknown;
}

interface RegisterCliHandlerTarget {
	registerCliHandler?: (
		command: string,
		description: string,
		flags: CliFlags | null,
		handler: (params: CliData) => string | Promise<string>,
	) => void;
}

const RUN_FLAGS: CliFlags = {
	choice: {
		value: "<name>",
		description: "Choice name",
	},
	id: {
		value: "<id>",
		description: "Choice id",
	},
	vars: {
		value: "<json>",
		description: "Variables object as JSON",
	},
	ui: {
		description: "Allow interactive prompts",
	},
};

const LIST_FLAGS: CliFlags = {
	type: {
		value: "<Template|Capture|Macro|Multi>",
		description: "Filter by choice type",
	},
	commands: {
		description: "Only include command-enabled choices",
	},
};

const CHECK_FLAGS: CliFlags = {
	choice: {
		value: "<name>",
		description: "Choice name",
	},
	id: {
		value: "<id>",
		description: "Choice id",
	},
	vars: {
		value: "<json>",
		description: "Variables object as JSON",
	},
};

const RESERVED_RUN_PARAMS = new Set<string>(["choice", "id", "vars", "ui"]);
const RESERVED_CHECK_PARAMS = new Set<string>(["choice", "id", "vars"]);

const CLI_COMMANDS = {
	runDefault: "quickadd",
	run: "quickadd:run",
	list: "quickadd:list",
	check: "quickadd:check",
} as const;

const SUPPORTED_LIST_TYPES = new Set(["template", "capture", "macro", "multi"]);

function serialize(response: CliResponse): string {
	return JSON.stringify(response);
}

function isTruthy(value: string | "true" | undefined): boolean {
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
			`Invalid vars JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Invalid vars JSON: expected an object");
	}

	return parsed as Record<string, unknown>;
}

function extractVariables(
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

function flattenChoices(
	choices: IChoice[],
	segments: string[] = [],
): CliChoiceSummary[] {
	const flattened: CliChoiceSummary[] = [];

	for (const choice of choices) {
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
			const multiChoice = choice as IMultiChoice;
			flattened.push(...flattenChoices(multiChoice.choices, pathSegments));
		}
	}

	return flattened;
}

function resolveChoiceFromParams(plugin: QuickAdd, params: CliData): IChoice {
	if (typeof params.id === "string" && params.id.trim().length > 0) {
		return plugin.getChoiceById(params.id);
	}

	if (typeof params.choice === "string" && params.choice.trim().length > 0) {
		return plugin.getChoiceByName(params.choice);
	}

	throw new Error("Missing choice selector. Provide either choice=<name> or id=<id>");
}

function toMissingFieldSummary(requirement: {
	id: string;
	label: string;
	type: string;
	placeholder?: string;
	defaultValue?: string;
	description?: string;
	source?: string;
	options?: string[];
}) {
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

function setExecutorVariables(
	choiceExecutor: IChoiceExecutor,
	variables: Record<string, unknown>,
) {
	for (const [key, value] of Object.entries(variables)) {
		choiceExecutor.variables.set(key, value);
	}
}

function describeChoice(choice: IChoice) {
	return {
		id: choice.id,
		name: choice.name,
		type: choice.type,
	};
}

async function runChoiceHandler(
	plugin: QuickAdd,
	params: CliData,
	command: string,
): Promise<string> {
	const startedAt = Date.now();

	try {
		const choice = resolveChoiceFromParams(plugin, params);
		if (choice.type === "Multi") {
			return serialize({
				ok: false,
				command,
				error: "Multi choices are interactive and cannot be run via CLI.",
				choice: describeChoice(choice),
			});
		}

		const variables = extractVariables(params, RESERVED_RUN_PARAMS);
		const choiceExecutor = new ChoiceExecutor(
			plugin.app,
			plugin,
		) as IChoiceExecutor;
		setExecutorVariables(choiceExecutor, variables);

		const interactiveMode = isTruthy(params.ui);
		if (!interactiveMode) {
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
			if (unresolved.length > 0) {
				return serialize({
					ok: false,
					command,
					error: "Missing required inputs for non-interactive CLI run.",
					choice: describeChoice(choice),
					missing: unresolved.map(toMissingFieldSummary),
					missingFlags: unresolved.map(
						(requirement) => `value-${requirement.id}=<value>`,
					),
				});
			}
		}

		await choiceExecutor.execute(choice);
		const aborted = choiceExecutor.consumeAbortSignal?.();
		const durationMs = Date.now() - startedAt;

		if (aborted) {
			return serialize({
				ok: false,
				command,
				error: aborted.message || "Choice execution aborted",
				aborted: true,
				choice: describeChoice(choice),
				durationMs,
			});
		}

		return serialize({
			ok: true,
			command,
			choice: describeChoice(choice),
			durationMs,
		});
	} catch (error) {
		return serialize({
			ok: false,
			command,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function listChoicesHandler(plugin: QuickAdd, params: CliData): string {
	try {
		const requestedTypeRaw =
			typeof params.type === "string" ? params.type.trim() : "";
		const requestedType = requestedTypeRaw.toLowerCase();
		const commandOnly = isTruthy(params.commands);
		if (requestedType && !SUPPORTED_LIST_TYPES.has(requestedType)) {
			return serialize({
				ok: false,
				command: CLI_COMMANDS.list,
				error: `Invalid type filter '${requestedTypeRaw}'.`,
			});
		}

		const allChoices = flattenChoices(plugin.settings.choices);
		const choices = allChoices.filter((choice) => {
			if (
				requestedType &&
				choice.type.toLowerCase() !== requestedType
			) {
				return false;
			}
			if (commandOnly && !choice.command) return false;
			return true;
		});

		return serialize({
			ok: true,
			command: CLI_COMMANDS.list,
			count: choices.length,
			choices,
		});
	} catch (error) {
		return serialize({
			ok: false,
			command: CLI_COMMANDS.list,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function checkChoiceHandler(
	plugin: QuickAdd,
	params: CliData,
): Promise<string> {
	try {
		const choice = resolveChoiceFromParams(plugin, params);
		if (choice.type === "Multi") {
			return serialize({
				ok: false,
				command: CLI_COMMANDS.check,
				error: "Multi choices are interactive and cannot be checked via CLI.",
				choice: describeChoice(choice),
			});
		}

		const variables = extractVariables(params, RESERVED_CHECK_PARAMS);
		const choiceExecutor = new ChoiceExecutor(
			plugin.app,
			plugin,
		) as IChoiceExecutor;
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

		return serialize({
			ok: unresolved.length === 0,
			command: CLI_COMMANDS.check,
			choice: describeChoice(choice),
			requiredInputCount: requirements.length,
			missingInputCount: unresolved.length,
			missing: unresolved.map(toMissingFieldSummary),
			missingFlags: unresolved.map(
				(requirement) => `value-${requirement.id}=<value>`,
			),
		});
	} catch (error) {
		return serialize({
			ok: false,
			command: CLI_COMMANDS.check,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function registerQuickAddCliHandlers(plugin: QuickAdd): boolean {
	const cliTarget = plugin as unknown as RegisterCliHandlerTarget;
	if (typeof cliTarget.registerCliHandler !== "function") {
		log.logMessage(
			"Skipping QuickAdd CLI handler registration: registerCliHandler is unavailable.",
		);
		return false;
	}

	const register = cliTarget.registerCliHandler.bind(cliTarget);

	register(
		CLI_COMMANDS.runDefault,
		"Run a QuickAdd choice",
		RUN_FLAGS,
		(params: CliData) =>
			runChoiceHandler(plugin, params, CLI_COMMANDS.runDefault),
	);
	register(
		CLI_COMMANDS.run,
		"Run a QuickAdd choice",
		RUN_FLAGS,
		(params: CliData) => runChoiceHandler(plugin, params, CLI_COMMANDS.run),
	);
	register(
		CLI_COMMANDS.list,
		"List QuickAdd choices",
		LIST_FLAGS,
		(params: CliData) => listChoicesHandler(plugin, params),
	);
	register(
		CLI_COMMANDS.check,
		"Check missing inputs for a QuickAdd choice",
		CHECK_FLAGS,
		(params: CliData) => checkChoiceHandler(plugin, params),
	);

	log.logMessage("Registered QuickAdd CLI handlers.");
	return true;
}
