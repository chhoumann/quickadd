import { Notice, type App } from "obsidian";
import { CaptureChoiceBuilder } from "../ChoiceBuilder/captureChoiceBuilder";
import { TemplateChoiceBuilder } from "../ChoiceBuilder/templateChoiceBuilder";
import { confirmAction } from "../confirmAction";
import { MacroBuilder } from "../MacroGUIs/MacroBuilder";
import { MultiChoiceBuilder } from "../MultiChoiceBuilder";
import { snapshot } from "../svelte/persist.svelte";
import type { ChoiceBuilderPlugin } from "../../types/pluginContext";
import { settingsStore } from "../../settingsStore";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { isUnreadableCommandList, macroCommandsValueOf } from "../../utils/macroUtils";
import {
	childChoicesOf,
	flattenChoices,
	hasUnreadableChildren,
} from "../../utils/choiceUtils";
import { choiceNoun } from "../../utils/choiceNoun";
import {
	clearUserScriptSecretsFromCommand,
	detectUserScriptSecretOptions,
} from "../../utils/userScriptSecrets";
import { log } from "../../logger/logManager";
import { escapesVaultBoundary } from "../../utils/vaultPathBoundary";
import {
	collectUserScriptPathsFromChoice,
	duplicateChoice,
} from "../../services/choiceTree";

export async function duplicateChoiceWithUserScriptSecretSanitization(
	choice: IChoice,
	app: App,
): Promise<IChoice> {
	const secretOptionNamesByPath = await buildSecretOptionNamesByPath(app, choice);

	return duplicateChoice(choice, {
		secretOptionNamesByPath,
		stripUnknownStringSettings: true,
	});
}

async function buildSecretOptionNamesByPath(
	app: App,
	choice: IChoice,
): Promise<Map<string, ReadonlySet<string> | null>> {
	const paths = new Set<string>();
	collectUserScriptPathsFromChoice(choice, paths);
	const secretOptionNamesByPath = new Map<string, ReadonlySet<string> | null>();

	for (const path of paths) {
		try {
			// A Macro choice's userscript path comes from data.json, which is untrusted
			// on a synced/shared/imported vault. Never stat or read an out-of-vault path
			// (e.g. "../../../etc/passwd"); treat it as not-present, mirroring the package
			// import probes (escapesVaultBoundary, #1434).
			if (escapesVaultBoundary(path)) continue;

			const exists = await app.vault.adapter.exists(path);
			if (!exists) continue;

			const detection = detectUserScriptSecretOptions(
				await app.vault.adapter.read(path),
				path,
			);
			secretOptionNamesByPath.set(
				path,
				detection.foundSecretOptions && detection.names.size === 0
					? null
					: detection.names,
			);
		} catch (error) {
			log.logWarning(
				`QuickAdd could not inspect user-script settings '${path}' while duplicating choice: ${
					(error as Error)?.message ?? error
				}`,
			);
		}
	}

	return secretOptionNamesByPath;
}

/**
 * The builder page for a choice, not yet open. It hands the edited choice to
 * `onSave` when it saves.
 */
export function getChoiceBuilder(
	choice: IChoice,
	app: App,
	plugin: ChoiceBuilderPlugin,
	onSave: (choice: IChoice) => void,
): { open(): boolean } {
	switch (choice.type) {
		case "Template":
			return new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin, onSave);
		case "Capture":
			return new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin, onSave);
		case "Macro":
			return new MacroBuilder(
				app,
				plugin,
				choice as IMacroChoice,
				settingsStore.getState().choices,
				onSave,
			);
		case "Multi":
			return new MultiChoiceBuilder(app, choice as IMultiChoice, onSave);
		default:
			throw new Error("Invalid choice type");
	}
}

/**
 * Handle choice deletion with confirmation
 */
export async function deleteChoiceWithConfirmation(
	choice: IChoice,
	app: App,
): Promise<boolean> {
	const isMulti = choice.type === "Multi";
	const isMacro = choice.type === "Macro";

	// Count the FULL subtree — a recursive delete removes everything nested, so
	// direct children would understate it. Folders and leaf choices are counted
	// separately because a nested folder is not a "choice" in the UI's own
	// vocabulary (#1552), and lumping them together is exactly the mislabel this
	// dialog is being fixed for. Zero descendants gets no warning at all.
	const buildMultiWarning = (multi: IMultiChoice): string => {
		// A malformed Multi (children missing, or not an array) is deliberately
		// preserved on load rather than repaired - see dedupeChoicesById. It still
		// has to be deletable, so it must not throw here: ChoiceView awaits this
		// function from a click handler that discards the promise, so a throw
		// would surface as an unhandled rejection and the corrupt folder would be
		// undeletable. But when the value could still be HOLDING choices, saying
		// nothing would let the user delete data the UI never showed them. Same
		// predicate as the folder's own hint, so the two surfaces cannot
		// disagree (#1566).
		if (hasUnreadableChildren(multi)) {
			return "QuickAdd couldn't read this folder's contents. Deleting it also deletes whatever is still stored under it in data.json.";
		}
		const descendants = flattenChoices(childChoicesOf(multi));
		if (descendants.length === 0) return "";

		const folders = descendants.filter((c) => c.type === "Multi").length;
		const choices = descendants.length - folders;
		const parts: string[] = [];
		if (choices > 0) parts.push(`${choices} ${choices === 1 ? "choice" : "choices"}`);
		if (folders > 0) parts.push(`${folders} ${folders === 1 ? "folder" : "folders"}`);

		return `Deleting this folder will also delete everything inside it: ${parts.join(" and ")}.`;
	};

	// Delete is the one irreversible action in the settings list, and until #1612
	// the two container types were treated asymmetrically: a folder whose children
	// could not be read said so, a macro whose commands could not be read said only
	// the generic line - which is true, and silent about the case that matters.
	//
	// Since #1593 the macro builder tells the user about that state and refuses to
	// overwrite it. This reads the SAME predicate through the SAME accessor the
	// builder resolves its list with, so the screen that reports the state and the
	// screen that destroys it cannot disagree. `macroCommandsValueOf` (not
	// `macro?.commands`) is what makes the unreadable-`macro`-object case - a
	// string, a number, an array-turned-object - resolve here exactly as it does
	// there; a genuinely array-valued `macro` IS the command list, is readable, and
	// correctly keeps the ordinary line.
	const buildMacroWarning = (macroChoice: IMacroChoice): string =>
		isUnreadableCommandList(macroCommandsValueOf(macroChoice.macro))
			? "QuickAdd couldn't read this macro's commands. Deleting it also deletes whatever is still stored under it in data.json."
			: "Deleting this choice will also delete its macro commands.";

	const body = [
		`Are you sure you want to delete '${choice.name}'?`,
		isMulti ? buildMultiWarning(choice as IMultiChoice) : "",
		isMacro ? buildMacroWarning(choice as IMacroChoice) : "",
	]
		.filter(Boolean)
		.join(" ");

	const userConfirmed = await confirmAction(app, {
		title: `Delete ${choiceNoun(choice.type)}`,
		message: body,
		action: "Delete",
	});

	if (!userConfirmed) return false;

	if (isMacro || isMulti) {
		const cleared = await clearUserScriptSecretsFromCommand(app, {
			type: "NestedChoice",
			choice,
		});
		if (!cleared) {
			new Notice(
				`Could not clear user script secrets. The ${choiceNoun(choice.type)} was not deleted.`,
			);
			return false;
		}
	}

	return true;
}

/**
 * Open a choice's builder as a page of Settings → QuickAdd. Each time it
 * saves (when it is left, and when the app goes to the background), `onSave`
 * gets the edited choice and the choice as of the previous save, or as the
 * builder opened it: after it filled in missing fields, so those don't count
 * as edits. Returns false if the page could not open.
 */
export function configureChoice(
	choice: IChoice,
	app: App,
	plugin: ChoiceBuilderPlugin,
	onSave: (edited: IChoice, base: IChoice) => void,
): boolean {
	const builder = getChoiceBuilder(choice, app, plugin, (edited) => {
		const saved = snapshot(edited);
		onSave(saved, base);
		base = saved;
	});
	let base: IChoice = snapshot(choice);
	return builder.open();
}
