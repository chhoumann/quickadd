import type { App } from "obsidian";
import type { ChoiceType } from "src/types/choices/choiceType";
import { CaptureChoiceBuilder } from "../gui/ChoiceBuilder/captureChoiceBuilder";
import { TemplateChoiceBuilder } from "../gui/ChoiceBuilder/templateChoiceBuilder";
import GenericInputPrompt from "../gui/GenericInputPrompt/GenericInputPrompt";
import GenericYesNoPrompt from "../gui/GenericYesNoPrompt/GenericYesNoPrompt";
import { MacroBuilder } from "../gui/MacroGUIs/MacroBuilder";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { excludeKeys } from "../utilityObsidian";
import { regenerateIds } from "../utils/macroUtils";
import { deepClone } from "../utils/deepClone";

const choiceConstructors: Record<ChoiceType, new (name: string) => IChoice> = {
	Template: TemplateChoice,
	Capture: CaptureChoice,
	Macro: MacroChoice,
	Multi: MultiChoice,
};

export function createChoice(type: ChoiceType, name: string): IChoice {
	const Constructor = choiceConstructors[type];
	if (!Constructor) throw new Error(`Unknown choice type: ${type}`);
	return new Constructor(name);
}

/**
 * Recursively duplicates a choice, ensuring unique ids and deep-cloning macros.
 */
export function duplicateChoice(choice: IChoice): IChoice {
	const newChoice = createChoice(choice.type, `${choice.name} (copy)`);

	if (choice.type === "Multi") {
		(newChoice as IMultiChoice).choices = (choice as IMultiChoice).choices.map(
			duplicateChoice,
		);
		return newChoice;
	}

	// copy simple props except id/name
	Object.assign(newChoice, excludeKeys(choice, ["id", "name"]));

	if (choice.type === "Macro") {
		(newChoice as IMacroChoice).macro = deepClone((choice as IMacroChoice).macro);
		regenerateIds((newChoice as IMacroChoice).macro);
	}

	return newChoice;
}

/**
 * Get the appropriate builder for a choice
 */
export function getChoiceBuilder(
	choice: IChoice,
	app: App,
	plugin: QuickAdd,
): TemplateChoiceBuilder | CaptureChoiceBuilder | MacroBuilder | undefined {
	type Builder =
		| TemplateChoiceBuilder
		| CaptureChoiceBuilder
		| MacroBuilder
		| undefined;

	const builderFactory: Record<ChoiceType, () => Builder> = {
		Template: () =>
			new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin),
		Capture: () =>
			new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin),
		Macro: () =>
			new MacroBuilder(
				app,
				plugin,
				choice as IMacroChoice,
				settingsStore.getState().choices,
			),
		Multi: () => undefined,
	};

	const creator = builderFactory[choice.type];
	return typeof creator === "function" ? creator() : undefined;
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

	const userConfirmed: boolean = await GenericYesNoPrompt.Prompt(
		app,
		`Confirm deletion of choice`,
		`Please confirm that you wish to delete '${choice.name}'.
            ${isMulti
			? "Deleting this choice will delete all (" +
			(choice as IMultiChoice).choices.length +
			") choices inside it!"
			: ""
		}
            ${isMacro
			? "Deleting this choice will delete its macro commands!"
			: ""
		}
            `,
	);

	return userConfirmed;
}

/**
 * Configure a choice through its builder
 */
export async function configureChoice(
	choice: IChoice,
	app: App,
	plugin: QuickAdd,
): Promise<IChoice | undefined> {
	if (choice.type === "Multi") {
		const name = await GenericInputPrompt.Prompt(
			app,
			`Rename ${choice.name}`,
			"",
			choice.name,
		);
		if (!name) return undefined;

		return { ...choice, name };
	}

	const builder = getChoiceBuilder(choice, app, plugin);
	if (!builder) {
		throw new Error("Invalid choice type");
	}

	return await builder.waitForClose;
}

/**
 * Toggle command registration for a choice
 */
export function createToggleCommandChoice(choice: IChoice): IChoice {
	return { ...choice, command: !choice.command };
}

/**
 * Command registry adapter to decouple plugin interactions
 */
export class CommandRegistry {
	constructor(private plugin: QuickAdd) { }

	enableCommand(choice: IChoice): void {
		this.plugin.addCommandForChoice(choice);
	}

	disableCommand(choice: IChoice): void {
		this.plugin.removeCommandForChoice(choice);
	}

	updateCommand(oldChoice: IChoice, newChoice: IChoice): void {
		this.plugin.removeCommandForChoice(oldChoice);
		this.plugin.addCommandForChoice(newChoice);
	}
}

/**
 * Move a choice into a target Multi choice at the end of its list.
 * Prevents cycles (cannot move a Multi into itself or any of its descendants).
 * Returns a new choices array (immutable) suitable for Svelte reactivity.
 */
export function moveChoice(
	rootChoices: IChoice[],
	movingId: string,
	targetMultiId: string,
): IChoice[] {
	if (!movingId || !targetMultiId) return rootChoices;

	const movingChoice = findChoiceById(rootChoices, movingId);
	const targetChoice = findChoiceById(rootChoices, targetMultiId);
	if (!movingChoice || !targetChoice || targetChoice.type !== "Multi") {
		return rootChoices;
	}

	// Prevent cycles: cannot move a Multi into itself or its descendants
	if (movingChoice.type === "Multi") {
		if (movingChoice.id === targetChoice.id) return rootChoices;
		const descendantIds = collectDescendantIds(movingChoice as IMultiChoice);
		if (descendantIds.has(targetChoice.id)) return rootChoices;
	}

	// Remove moving choice from its current location
	const { updated: withoutMoving, removed } = removeChoiceById(rootChoices, movingId);
	if (!removed) return rootChoices; // nothing removed

	// Insert at end of the target multi
	const inserted = insertIntoMulti(withoutMoving, targetMultiId, removed);
	return inserted ?? rootChoices;
}

function findChoiceById(choices: IChoice[], id: string): IChoice | undefined {
	for (const c of choices) {
		if (c.id === id) return c;
		if (c.type === "Multi") {
			const found = findChoiceById((c as IMultiChoice).choices, id);
			if (found) return found;
		}
	}
	return undefined;
}

function collectDescendantIds(multi: IMultiChoice): Set<string> {
	const ids = new Set<string>();
	const walk = (c: IChoice) => {
		ids.add(c.id);
		if (c.type === "Multi") (c as IMultiChoice).choices.forEach(walk);
	};
	(multi.choices ?? []).forEach(walk);
	return ids;
}

function removeChoiceById(
	choices: IChoice[],
	id: string,
): { updated: IChoice[]; removed?: IChoice } {
	let removed: IChoice | undefined;
	const updated = choices
		.map((c) => {
			if (c.id === id) {
				removed = c;
				return undefined;
			}
			if (c.type !== "Multi") return c;
			const res = removeChoiceById((c as IMultiChoice).choices, id);
			if (res.removed) removed = res.removed;
			if (res.removed) {
				// Only recreate object when children changed
				return { ...(c as IMultiChoice), choices: res.updated } as IChoice;
			}
			return c;
		})
		.filter(Boolean) as IChoice[];

	return { updated, removed };
}

function insertIntoMulti(
	choices: IChoice[],
	targetId: string,
	child: IChoice,
): IChoice[] | undefined {
	let changed = false;
	const updated = choices.map((c) => {
		if (c.id === targetId && c.type === "Multi") {
			changed = true;
			const mc = c as IMultiChoice;
			return { ...mc, choices: [...mc.choices, child] } as IChoice;
		}
		if (c.type !== "Multi") return c;
		const inner = insertIntoMulti((c as IMultiChoice).choices, targetId, child);
		if (inner) {
			changed = true;
			return { ...(c as IMultiChoice), choices: inner } as IChoice;
		}
		return c;
	});

	return changed ? updated : undefined;
}
