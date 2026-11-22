import type { Plugin } from "obsidian";
import { ChoiceExecutor } from "../choiceExecutor";
import { log } from "../logger/logManager";
import {
	choiceCommandId,
	pickDayCommandId,
	pickDayCommandName,
	shouldRegisterPickDayCommand,
} from "../types/choiceCommands";
import type IChoice from "../types/choices/IChoice";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import {
	childChoicesOf,
	findChoiceWithPath,
	isChoiceLike,
	resolveChoiceIcon,
	rootChoicesOf,
} from "../utils/choiceUtils";
import { reportError, reportUnlessCancelled } from "../utils/errorUtils";

type ChoiceCommandPlugin = ChoiceRuntimePlugin & Pick<Plugin, "addCommand" | "removeCommand">;

/**
 * Finds choices in the plugin's settings and keeps a palette command for every
 * choice that has its command turned on.
 */
export class ChoiceCommandManager {
	/**
	 * `isUnloaded`: work started before unload can finish after it. Obsidian
	 * keeps commands an unloaded plugin adds, and command ids are shared with the
	 * next instance, so an unloaded instance must not add or remove any.
	 */
	constructor(
		private readonly plugin: ChoiceCommandPlugin,
		private readonly isUnloaded: () => boolean,
	) {}

	findChoiceById(id: string): IChoice | null {
		return findChoiceWithPath(this.plugin.settings.choices, "id", id)?.choice ?? null;
	}

	findChoiceByName(name: string): IChoice | null {
		return findChoiceWithPath(this.plugin.settings.choices, "name", name)?.choice ?? null;
	}

	getChoiceById(id: string): IChoice {
		const choice = this.findChoiceById(id);
		if (!choice) throw new Error(`Choice ${id} not found`);
		return choice;
	}

	getChoiceByName(name: string): IChoice {
		const choice = this.findChoiceByName(name);
		if (!choice) throw new Error(`Choice ${name} not found`);
		return choice;
	}

	/**
	 * How many choices anywhere in the tree carry `name`. Choices hidden inside an
	 * unreadable `choices` value are not counted, so the warning can only
	 * under-report.
	 */
	private countChoicesByName(
		name: string,
		choices: IChoice[] = this.plugin.settings.choices,
	): number {
		let count = 0;
		for (const choice of rootChoicesOf(choices)) {
			if (!isChoiceLike(choice)) continue;
			if (choice.name === name) count++;
			if (choice.type === "Multi") {
				count += this.countChoicesByName(name, childChoicesOf(choice));
			}
		}
		return count;
	}

	/**
	 * Warns when a URI's `choice=<name>` is ambiguous, so an automation that ran
	 * the first matching choice is at least diagnosable.
	 */
	warnIfChoiceNameAmbiguous(name: string): void {
		const matches = this.countChoicesByName(name);
		if (matches > 1) {
			log.logWarning(
				`QuickAdd URI: ${matches} choices are named '${name}'. Ran the first match — rename choices to keep names unique so URIs target the right one.`,
			);
		}
	}

	addCommandsForChoices(choices: IChoice[]): void {
		for (const choice of rootChoicesOf(choices)) {
			// A list entry can be a hole (`null`, a stray primitive) left by a bad
			// edit or a truncated write; it is not a choice, so there is no command
			// to register for it.
			if (!isChoiceLike(choice)) continue;
			// Fault-isolate the loop: it runs from onload against untrusted
			// data.json, and one defect should cost one command, not the
			// migrations, CLI and startup macros that follow.
			try {
				this.addCommandForChoice(choice);
			} catch (err) {
				reportError(err, `Could not add a command for a QuickAdd choice`);
			}
		}
	}

	addCommandForChoice(choice: IChoice): void {
		if (this.isUnloaded()) return;
		if (choice.type === "Multi") {
			this.addCommandsForChoices(childChoicesOf(choice));
		}

		if (choice.command) {
			const choiceId = choice.id;

			this.plugin.addCommand({
				id: choiceCommandId(choiceId),
				name: choice.name,
				icon: resolveChoiceIcon(choice),
				callback: () => this.runRegisteredChoice(choiceId, choice.name),
			});

			if (
				shouldRegisterPickDayCommand({
					origin: choice.dateOrigin,
					enabled: choice.pickDayCommand,
				})
			) {
				this.plugin.addCommand({
					id: pickDayCommandId(choiceId),
					name: pickDayCommandName(choice.name),
					icon: resolveChoiceIcon(choice),
					callback: () =>
						this.runRegisteredChoice(choiceId, choice.name, true),
				});
			}
		}
	}

	removeCommandForChoice(
		choice: IChoice,
		options?: { recursive?: boolean },
	): void {
		if (this.isUnloaded()) return;
		// Recurse ONLY when the whole subtree is going away (a folder DELETE):
		// a Multi (folder) registers commands for its command-enabled descendants,
		// so tearing it down must remove theirs too, or deleting a folder leaves
		// orphaned palette entries that throw "Choice <id> not found" when invoked.
		//
		// Do NOT recurse when only the folder's OWN command is being removed (e.g.
		// toggling the folder's command off, or the remove half of an update): the
		// children remain and their still-enabled commands must stay registered.
		if (options?.recursive && choice.type === "Multi") {
			for (const child of childChoicesOf(choice)) {
				if (!isChoiceLike(child)) continue;
				this.removeCommandForChoice(child, options);
			}
		}

		this.plugin.removeCommand(choiceCommandId(choice.id));
		this.plugin.removeCommand(pickDayCommandId(choice.id));
	}

	/** Drop the commands of `previousChoices` and register those of the current choices. */
	replaceCommands(previousChoices: IChoice[]): void {
		for (const choice of rootChoicesOf(previousChoices)) {
			if (isChoiceLike(choice)) this.removeCommandForChoice(choice, { recursive: true });
		}
		this.addCommandsForChoices(this.plugin.settings.choices);
	}

	private async runRegisteredChoice(
		choiceId: string,
		fallbackName: string,
		pickDay = false,
	): Promise<void> {
		// Resolved outside the try so the failure can name the choice the user
		// actually ran; a bare UUID tells them nothing. Falls back to the name
		// captured at registration when the lookup itself is what failed.
		let current: IChoice | undefined;
		try {
			current = this.getChoiceById(choiceId);
			const executor = new ChoiceExecutor(this.plugin.app, this.plugin);
			if (pickDay) executor.callerDay = "pick";
			await executor.execute(current);
		} catch (err) {
			// The outermost handler: reports only what nothing below already
			// reported, and stays silent when the user dismissed a prompt.
			reportUnlessCancelled(
				err,
				`Could not run "${current?.name ?? fallbackName}"`,
			);
		}
	}
}
