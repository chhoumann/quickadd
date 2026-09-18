import type { CliData, CliFlags } from "obsidian";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import { checkChoiceHandler, listChoicesHandler, previewPackageHandler } from "./inspectChoices";
import { CHECK_FLAGS, INTERACTIVE_FLAGS, LIST_FLAGS, PREVIEW_FLAGS, RUN_FLAGS, RUN_TEMPLATE_FLAGS } from "./params";
import { runChoice, runInteractive, runTemplate } from "./runChoice";
import { SAVE_CLIPBOARD_IMAGE_COMMAND, SAVE_CLIPBOARD_IMAGE_FLAGS, saveClipboardImageHandler } from "./saveClipboardImageCli";

type CliResult = { ok: boolean;[key: string]: unknown };
interface RegisterCliHandlerTarget {
	registerCliHandler?: (
		command: string,
		description: string,
		flags: CliFlags | null,
		handler: (params: CliData) => string | Promise<string>,
	) => void;
}

const CLI_COMMANDS = {
	runDefault: "quickadd",
	run: "quickadd:run",
	runTemplate: "quickadd:run-template",
	list: "quickadd:list",
	check: "quickadd:check",
	preview: "quickadd:package-preview",
	interactive: "quickadd:interactive",
	saveClipboardImage: SAVE_CLIPBOARD_IMAGE_COMMAND,
} as const;

export function registerQuickAddCliHandlers(plugin: QuickAdd): boolean {
	const cliTarget = plugin as unknown as RegisterCliHandlerTarget;
	if (typeof cliTarget.registerCliHandler !== "function") {
		log.logMessage(
			"Skipping QuickAdd CLI handler registration: registerCliHandler is unavailable.",
		);
		return false;
	}

	const register = (
		command: string,
		description: string,
		flags: CliFlags,
		handler: (params: CliData) => CliResult | Promise<CliResult>,
	) => cliTarget.registerCliHandler!.call(cliTarget, command, description, flags, async (params: CliData) => {
		try {
			return JSON.stringify({ command, ...await handler(params) });
		} catch (error) {
			return JSON.stringify({ ok: false, command, error: error instanceof Error ? error.message : String(error) });
		}
	});

	register(
		CLI_COMMANDS.runDefault,
		"Run a QuickAdd choice (ok:true reports the choice ran without aborting; check verified to know QuickAdd confirmed the run, and effect to know whether the vault changed: created/changed/unchanged/unknown)",
		RUN_FLAGS,
		(params: CliData) =>
			runChoice(plugin, params),
	);
	register(
		CLI_COMMANDS.run,
		"Run a QuickAdd choice (ok:true reports the choice ran without aborting; check verified to know QuickAdd confirmed the run, and effect to know whether the vault changed: created/changed/unchanged/unknown)",
		RUN_FLAGS,
		(params: CliData) => runChoice(plugin, params),
	);
	register(
		CLI_COMMANDS.runTemplate,
		"Create a new note from a template file (no Template choice required)",
		RUN_TEMPLATE_FLAGS,
		(params: CliData) => runTemplate(plugin, params),
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
	register(
		CLI_COMMANDS.interactive,
		"Run a choice interactively: forwards its runtime prompts to the caller over a local server (returns host/port/sessionId/token to attach)",
		INTERACTIVE_FLAGS,
		(params: CliData) => runInteractive(plugin, params),
	);
	cliTarget.registerCliHandler.call(cliTarget,
		CLI_COMMANDS.saveClipboardImage,
		"Save a 1x1 PNG as a vault attachment using QuickAdd clipboard-image naming",
		SAVE_CLIPBOARD_IMAGE_FLAGS,
		(params: CliData) => saveClipboardImageHandler(plugin, params),
	);

	log.logMessage("Registered QuickAdd CLI handlers.");
	return true;
}
