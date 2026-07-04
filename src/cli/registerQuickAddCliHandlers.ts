import type { CliData, CliFlags } from "obsidian";
import { ChoiceExecutor } from "../choiceExecutor";
import { createFolderTemplateChoice } from "../engine/runTemplateFromFolder";
import { getTemplateFile } from "../utilityObsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import {
	collectChoiceRequirements,
	getUnresolvedRequirements,
} from "../preflight/collectChoiceRequirements";
import type { FieldRequirement } from "../preflight/RequirementCollector";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import {
	analysePackagePreview,
	readQuickAddPackage,
} from "../services/packageImportService";
import { decodeAssetPreview } from "../services/packagePreview";
import type {
	AssetPreviewContent,
	PackagePreview,
} from "../services/packagePreview";

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

interface PackagePreviewCliResponse extends CliResponse {
	preview: PackagePreview;
	contents?: Array<{ path: string } & AssetPreviewContent>;
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
	verify: {
		description:
			"Report the verified outcome for Template/Capture choices (file path on success, honest failure when the engine swallows an error)",
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

const RUN_TEMPLATE_FLAGS: CliFlags = {
	path: {
		value: "<vault-path>",
		description: "Path to a template file in the vault",
	},
	vars: {
		value: "<json>",
		description: "Variables object as JSON",
	},
	ui: {
		description: "Allow interactive prompts",
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
	fields: {
		description:
			"Include full field metadata (options, defaults, widget config)",
	},
};

const PREVIEW_FLAGS: CliFlags = {
	path: {
		value: "<vault-path>",
		description: "Path to a .quickadd.json package file in the vault",
	},
	decode: {
		description: "Inline decoded contents for each bundled file",
	},
};

// Reserved param names are consumed as command flags/selectors and NOT passed
// through as choice variables (extractVariables skips them). A choice whose
// variable is literally named after a flag (e.g. `{{VALUE:verify}}`,
// `{{VALUE:fields}}`, `{{VALUE:ui}}`) can't receive it via the bare
// `name=value` form; supply it with the unreserved `value-<name>=...` prefix or
// `vars=<json>` instead (see docs/docs/Advanced/CLI.md#reserved-flag-names).
const RESERVED_RUN_PARAMS = new Set<string>([
	"choice",
	"id",
	"vars",
	"ui",
	"verify",
]);
const RESERVED_RUN_TEMPLATE_PARAMS = new Set<string>(["path", "vars", "ui"]);
const RESERVED_CHECK_PARAMS = new Set<string>(["choice", "id", "vars", "fields"]);

const CLI_COMMANDS = {
	runDefault: "quickadd",
	run: "quickadd:run",
	runTemplate: "quickadd:run-template",
	list: "quickadd:list",
	check: "quickadd:check",
	preview: "quickadd:package-preview",
} as const;

const SUPPORTED_LIST_TYPES = new Set(["template", "capture", "macro", "multi"]);

function serialize(response: CliResponse): string {
	return JSON.stringify(response);
}

function isTruthy(value: string | undefined): boolean {
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

// Unlike the obsidian:// URI boundary, the CLI intentionally does NOT drop the
// reserved "__qa." prefix here: `value-__qa.captureTargetFilePath` is the
// documented way to pick a capture target non-interactively for a folder/tag/
// property-scoped Capture choice (see collectChoiceRequirements + the
// missingFlags hint). That stays safe because the capture engine only honours a
// preselected target within the configured scope (CaptureChoiceEngine
// getFormattedPathToCaptureTo), and CLI access already grants arbitrary code
// execution (quickadd:run can run a Macro choice), so this is not an escalation
// boundary.
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

function toMissingFieldSummary(requirement: FieldRequirement) {
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

/**
 * Full field metadata for external front ends (Raycast, scripts) that render
 * their own input controls instead of QuickAdd's modals. Superset of
 * toMissingFieldSummary; opt-in via the `fields` flag so the default envelope
 * stays compact (a file-picker's options can span a whole folder).
 */
function toDetailedFieldSummary(requirement: FieldRequirement) {
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

/**
 * Shared execution tail for any already-resolved choice (persisted via
 * `quickadd:run` or built ad-hoc via `quickadd:run-template`): variable wiring,
 * the non-interactive missing-input guard, execution, and the JSON envelope.
 */
async function runResolvedChoice(
	plugin: QuickAdd,
	params: CliData,
	command: string,
	choice: IChoice,
	reservedParams: Set<string>,
	/**
	 * Report the real execution outcome via executeWithOutcome (Template/Capture
	 * only) instead of trusting that the void execute() resolving means success.
	 * The Template/Capture engines swallow runtime failures (missing/empty file
	 * name, failing inline script, write error) — without this the CLI would
	 * report ok:true with no file created. quickadd:run keeps the legacy path.
	 */
	useOutcome = false,
): Promise<string> {
	const startedAt = Date.now();

	try {
		if (choice.type === "Multi") {
			return serialize({
				ok: false,
				command,
				error: "Multi choices are interactive and cannot be run via CLI.",
				choice: describeChoice(choice),
			});
		}

		const variables = extractVariables(params, reservedParams);
		const choiceExecutor = new ChoiceExecutor(
			plugin.app,
			plugin,
		) as IChoiceExecutor;
		setExecutorVariables(choiceExecutor, variables);

		const interactiveMode = isTruthy(params.ui);
		// Without `ui`, engine prompts the requirement collector can't pre-satisfy
		// (the "file already exists" prompt, folder chooser, heading picker) would
		// hang forever on an unanswerable modal. Mark the run non-interactive so the
		// engines abort those with a clear error instead. `ui` keeps full prompting.
		choiceExecutor.interactive = interactiveMode;
		if (!interactiveMode) {
			const requirements = await collectChoiceRequirements(
				plugin.app,
				plugin,
				choiceExecutor,
				choice,
				// Loading a user script to read quickadd.inputs executes its module
				// body; cache it on the executor so the run below consumes this
				// load instead of executing every script's top level twice.
				{ preloadedUserScripts: choiceExecutor.preloadedUserScripts },
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

		if (
			useOutcome &&
			(choice.type === "Template" || choice.type === "Capture") &&
			typeof choiceExecutor.executeWithOutcome === "function"
		) {
			const outcome = await choiceExecutor.executeWithOutcome(
				choice as ITemplateChoice | ICaptureChoice,
			);
			const durationMs = Date.now() - startedAt;

			if (outcome.status === "success") {
				return serialize({
					ok: true,
					command,
					choice: describeChoice(choice),
					file: outcome.file?.path,
					// The outcome path confirms the engine actually completed (a file
					// was created / capture written), so this success is verified.
					verified: true,
					durationMs,
				});
			}
			if (outcome.status === "cancelled") {
				return serialize({
					ok: false,
					command,
					// Surface the engine's actionable abort reason (e.g. the non-interactive
					// "file already exists" / folder-chooser guard) when present, so a
					// headless caller learns how to fix it instead of a bare "aborted".
					error:
						outcome.reason ||
						(outcome.cancelKind === "user"
							? "Execution cancelled by user"
							: "Execution aborted"),
					aborted: true,
					choice: describeChoice(choice),
					durationMs,
				});
			}
			return serialize({
				ok: false,
				command,
				error: "Choice execution failed; no file was created.",
				choice: describeChoice(choice),
				durationMs,
			});
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
			// Legacy void-execute path: the Template/Capture engines swallow runtime
			// failures (empty file name, failing inline script, write error) without
			// signalling abort, so a resolving execute() does NOT guarantee a file was
			// created. Flag the success as unverified so scripts keying retry/notify
			// logic off `ok` can tell it apart from the verified outcome path (and use
			// quickadd:check up front, or quickadd:run-template for a verified create).
			verified: false,
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

async function runChoiceHandler(
	plugin: QuickAdd,
	params: CliData,
	command: string,
): Promise<string> {
	let choice: IChoice;
	try {
		choice = resolveChoiceFromParams(plugin, params);
	} catch (error) {
		return serialize({
			ok: false,
			command,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	return runResolvedChoice(
		plugin,
		params,
		command,
		choice,
		RESERVED_RUN_PARAMS,
		// Opt-in (`verify`) so existing scripts keying off the legacy envelope
		// keep their behavior; run-template made the outcome path the default
		// from the start, quickadd:run could not.
		/* useOutcome */ isTruthy(params.verify),
	);
}

async function runTemplateHandler(
	plugin: QuickAdd,
	params: CliData,
): Promise<string> {
	const command = CLI_COMMANDS.runTemplate;

	// Wrapped so malformed input (e.g. invalid vars= JSON parsed by the up-front
	// name check) returns the standard {ok:false,error} envelope instead of
	// rejecting the handler — matching quickadd:run and run-template's ui path.
	try {
		const path = typeof params.path === "string" ? params.path.trim() : "";
		if (!path) {
			return serialize({
				ok: false,
				command,
				error: "Missing template path. Provide path=<vault-path>.",
			});
		}

		// Honest envelope: confirm the template file exists up front rather than
		// letting the engine swallow a missing-file error and report ok:true. Use
		// the engine's own resolver (getTemplateFile) so the CLI accepts exactly the
		// paths the engine does — leading slash stripped, ".md" appended — instead of
		// a stricter raw lookup that rejects "Templates/Daily" or "/Templates/Daily.md".
		const file = getTemplateFile(plugin.app, path);
		if (!file) {
			return serialize({
				ok: false,
				command,
				error: `No template file found at '${path}'.`,
			});
		}

		// Build from the resolved path so the note-name prompt header (basename) and
		// the content read agree with what the engine will open.
		const choice = createFolderTemplateChoice(file.path);

		// Honest envelope for the note name. The name is {{value}}; when it's provided
		// but blank, the requirement collector consumes it (so the standard guard sees
		// nothing missing) and the engine then throws "File name is empty" and swallows
		// it — reporting a false ok:true with no note created. Reject a blank name up
		// front for non-interactive runs (ui mode can still prompt). Headless runs have
		// no editor selection, so {{value}} comes solely from this variable.
		if (!isTruthy(params.ui)) {
			const variables = extractVariables(params, RESERVED_RUN_TEMPLATE_PARAMS);
			const name = variables.value;
			if (name == null || String(name).trim().length === 0) {
				return serialize({
					ok: false,
					command,
					error: "Missing required inputs for non-interactive CLI run.",
					choice: describeChoice(choice),
					missing: [
						{
							id: "value",
							label: "New note name",
							type: "text",
							source: "collected",
							optionCount: 0,
						},
					],
					missingFlags: ["value-value=<value>"],
				});
			}
		}

		return await runResolvedChoice(
			plugin,
			params,
			command,
			choice,
			RESERVED_RUN_TEMPLATE_PARAMS,
			/* useOutcome */ true,
		);
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
		const summarize = isTruthy(params.fields)
			? toDetailedFieldSummary
			: toMissingFieldSummary;

		return serialize({
			ok: unresolved.length === 0,
			command: CLI_COMMANDS.check,
			choice: describeChoice(choice),
			requiredInputCount: requirements.length,
			missingInputCount: unresolved.length,
			missing: unresolved.map(summarize),
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

async function previewPackageHandler(
	plugin: QuickAdd,
	params: CliData,
): Promise<string> {
	try {
		const path =
			typeof params.path === "string" ? params.path.trim() : "";
		if (!path) {
			return serialize({
				ok: false,
				command: CLI_COMMANDS.preview,
				error: "Missing package path. Provide path=<vault-path>.",
			});
		}

		const { pkg } = await readQuickAddPackage(plugin.app, path);
		const preview = await analysePackagePreview(
			plugin.app,
			plugin.settings.choices,
			pkg,
		);

		const response: PackagePreviewCliResponse = {
			ok: true,
			command: CLI_COMMANDS.preview,
			preview,
		};

		if (isTruthy(params.decode)) {
			response.contents = preview.files.map((file) => ({
				path: file.originalPath,
				...decodeAssetPreview(pkg, file.originalPath),
			}));
		}

		return serialize(response);
	} catch (error) {
		return serialize({
			ok: false,
			command: CLI_COMMANDS.preview,
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
		"Run a QuickAdd choice (ok:true reports the choice ran without aborting; check the verified flag to know if a file was created)",
		RUN_FLAGS,
		(params: CliData) =>
			runChoiceHandler(plugin, params, CLI_COMMANDS.runDefault),
	);
	register(
		CLI_COMMANDS.run,
		"Run a QuickAdd choice (ok:true reports the choice ran without aborting; check the verified flag to know if a file was created)",
		RUN_FLAGS,
		(params: CliData) => runChoiceHandler(plugin, params, CLI_COMMANDS.run),
	);
	register(
		CLI_COMMANDS.runTemplate,
		"Create a new note from a template file (no Template choice required)",
		RUN_TEMPLATE_FLAGS,
		(params: CliData) => runTemplateHandler(plugin, params),
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
	register(
		CLI_COMMANDS.preview,
		"Preview a QuickAdd package before importing (files + capabilities)",
		PREVIEW_FLAGS,
		(params: CliData) => previewPackageHandler(plugin, params),
	);

	log.logMessage("Registered QuickAdd CLI handlers.");
	return true;
}
