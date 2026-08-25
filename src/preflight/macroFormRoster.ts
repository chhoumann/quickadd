import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IChoice from "src/types/choices/IChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import type { ICommand } from "src/types/macros/ICommand";
import type { IUserScript } from "src/types/macros/IUserScript";
import { commandListOf, isCommandLike } from "src/utils/macroUtils";
import type { FieldGroup } from "./RequirementCollector";
import { classifyStep, type DeferralReason } from "./macroCommandRole";

export type FormRosterEntry =
	| {
			kind: "choice";
			choice: ITemplateChoice | ICaptureChoice;
			group: FieldGroup;
	  }
	| {
			kind: "script";
			command: IUserScript;
			group: FieldGroup;
	  };

export interface DeferredStep {
	label: string;
	reason: DeferralReason;
}

export interface FormRoster {
	members: FormRosterEntry[];
	deferred: DeferredStep[];
}

function groupForChoice(choice: IChoice): FieldGroup {
	return { id: choice.id, label: choice.name };
}

function groupForCommand(command: ICommand): FieldGroup {
	return { id: command.id, label: command.name };
}

export function buildFormRoster(
	resolveChoice: (id: string) => IChoice | null,
	macro: IMacroChoice,
): FormRoster {
	const members: FormRosterEntry[] = [];
	const deferred: DeferredStep[] = [];
	let opaqueSeen = false;

	for (const command of commandListOf(macro.macro?.commands)) {
		if (!isCommandLike(command)) continue;

		const role = classifyStep(command, resolveChoice);

		if (role.collect.kind === "scanChoice") {
			const choice = role.collect.choice;
			if (choice.onePageInput === "never") {
				deferred.push({ label: choice.name, reason: "choiceOptedOut" });
			} else if (opaqueSeen) {
				deferred.push({ label: choice.name, reason: "afterOpaqueStep" });
			} else {
				members.push({
					kind: "choice",
					choice,
					group: groupForChoice(choice),
				});
			}
		} else if (role.collect.kind === "scriptInputs") {
			members.push({
				kind: "script",
				command: role.collect.command,
				group: groupForCommand(role.collect.command),
			});
		} else if (role.deferred) {
			deferred.push({ label: command.name, reason: role.deferred });
		}

		if (role.opaque) opaqueSeen = true;
	}

	return { members, deferred };
}
