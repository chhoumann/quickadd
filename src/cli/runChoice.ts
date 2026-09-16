import type { CliData } from "obsidian";
import { ChoiceExecutor } from "../choiceExecutor";
import { QA_INTERNAL_DATE_ORIGIN } from "../constants";
import { createFolderTemplateChoice } from "../engine/runTemplateFromFolder";
import { interactivePromptServer } from "../interactive/interactivePromptServer";
import { RemotePromptProvider } from "../interactive/promptProvider";
import type QuickAdd from "../main";
import { collectChoiceRequirements, getUnresolvedRequirements } from "../preflight/collectChoiceRequirements";
import type IChoice from "../types/choices/IChoice";
import { getTemplateFile } from "../utilityObsidian";
import { applyInvocationDate } from "../utils/resolveDateOrigin";
import { executeChoice } from "./executeChoice";
import {
	describeChoice, extractVariables, isTruthy, resolveChoiceFromParams,
	RESERVED_INTERACTIVE_PARAMS, RESERVED_RUN_PARAMS, RESERVED_RUN_TEMPLATE_PARAMS,
	setExecutorVariables, toMissingFieldSummary,
} from "./params";

async function runResolvedChoice(
	plugin: QuickAdd,
	params: CliData,
	choice: IChoice,
	reservedParams: Set<string>,
	verify: boolean,
) {
	const startedAt = Date.now();
	const summary = describeChoice(choice);
	if (choice.type === "Multi") {
		return { ok: false, error: "Multi choices are interactive and cannot be run via CLI.", choice: summary };
	}

	const executor = new ChoiceExecutor(plugin.app, plugin);
	setExecutorVariables(executor, extractVariables(params, reservedParams));
	if (!applyInvocationDate(executor, params.date)) {
		return { ok: false, error: `Could not parse date origin '${params.date}'.`, choice: summary };
	}
	executor.interactive = isTruthy(params.ui);
	if (!executor.interactive) {
		// Reuse loaded script modules: collecting inputs can execute their top level.
		const requirements = await collectChoiceRequirements(plugin.app, plugin, executor, choice, {
			preloadedUserScripts: executor.preloadedUserScripts,
		});
		const unresolved = getUnresolvedRequirements(requirements, executor.variables);
		if (unresolved.length) {
			return {
				ok: false,
				error: "Missing required inputs for non-interactive CLI run.",
				choice: summary,
				missing: unresolved.map(toMissingFieldSummary),
				missingFlags: unresolved.map(({ id }) => id === QA_INTERNAL_DATE_ORIGIN
					? "date=<when>" : `value-${id}=<value>`),
			};
		}
	}
	const result = await executeChoice(executor, choice, verify);
	return { ...result, choice: summary, durationMs: Date.now() - startedAt };
}

export function runChoice(plugin: QuickAdd, params: CliData) {
	return runResolvedChoice(plugin, params, resolveChoiceFromParams(plugin, params),
		RESERVED_RUN_PARAMS, isTruthy(params.verify));
}

export async function runTemplate(plugin: QuickAdd, params: CliData) {
	const path = typeof params.path === "string" ? params.path.trim() : "";
	if (!path) return { ok: false, error: "Missing template path. Provide path=<vault-path>." };
	const file = getTemplateFile(plugin.app, path);
	if (!file) return { ok: false, error: `No template file found at '${path}'.` };
	const choice = createFolderTemplateChoice(file.path);
	if (!isTruthy(params.ui)) {
		const { value: name } = extractVariables(params, RESERVED_RUN_TEMPLATE_PARAMS);
		if (name == null || String(name).trim().length === 0) {
			return {
				ok: false,
				error: "Missing required inputs for non-interactive CLI run.",
				choice: describeChoice(choice),
				missing: [{ id: "value", label: "New note name", type: "text", source: "collected", optionCount: 0 }],
				missingFlags: ["value-value=<value>"],
			};
		}
	}
	return runResolvedChoice(plugin, params, choice, RESERVED_RUN_TEMPLATE_PARAMS, true);
}

export async function runInteractive(plugin: QuickAdd, params: CliData) {
	const choice = resolveChoiceFromParams(plugin, params);
	const summary = describeChoice(choice);
	if (choice.type === "Multi") {
		return { ok: false, error: "Multi choices cannot be run interactively via CLI.", choice: summary };
	}
	const port = await interactivePromptServer.ensureStarted();
	const { id: sessionId, token } = interactivePromptServer.createSession();
	const executor = new ChoiceExecutor(plugin.app, plugin);
	setExecutorVariables(executor, extractVariables(params, RESERVED_INTERACTIVE_PARAMS));
	executor.interactive = true;
	executor.promptProvider = new RemotePromptProvider(sessionId);

	// Return connection details before executing prompts; deliver completion over the server.
	void executeChoice(executor, choice, true).then(
		(result) => interactivePromptServer.finish(sessionId, result.ok
			? { kind: "done", result: { ...result, choice: summary } }
			: { kind: "error", error: result.error }),
		(error: unknown) => interactivePromptServer.finish(sessionId, {
			kind: "error", error: error instanceof Error ? error.message : String(error),
		}),
	);
	return {
		ok: true, choice: summary, host: "127.0.0.1", port, sessionId, token,
		capabilities: ["abort", "outcome-effect"]
	};
}
