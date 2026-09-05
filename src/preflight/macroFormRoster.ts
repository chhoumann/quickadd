import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IChoice from "src/types/choices/IChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import type { ICommand } from "src/types/macros/ICommand";
import type { IUserScript } from "src/types/macros/IUserScript";
import { commandListOf, isCommandLike } from "src/utils/macroUtils";
import { VALUE_SYNTAX } from "src/constants";
import { shouldRunTemplateNoteDiscovery } from "src/utils/templateNoteDiscoveryEligibility";
import type { FieldGroup } from "./RequirementCollector";
import { classifyStep, isTemplateChoice, type DeferralReason } from "./macroCommandRole";

export type FormRosterEntry =
	| {
			kind: "choice";
			occurrenceId: string;
			choice: ITemplateChoice | ICaptureChoice;
			group: FieldGroup;
	  }
	| {
			kind: "script";
			occurrenceId: string;
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

export function isDiscoveryInputBoundary(choice: IChoice, seededValue: unknown): boolean {
	return choice.onePageInput === "never" && isTemplateChoice(choice) &&
		shouldRunTemplateNoteDiscovery(
			choice,
			choice.fileNameFormat?.enabled ? choice.fileNameFormat.format : VALUE_SYNTAX,
			seededValue,
		);
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
	seededValue?: unknown,
): FormRoster {
	const members: FormRosterEntry[] = [];
	const deferred: DeferredStep[] = [];
	let opaqueSeen = false;
	let discoveryBoundarySeen = false;

	for (const command of commandListOf(macro.macro?.commands)) {
		if (!isCommandLike(command)) continue;

		const role = classifyStep(command, resolveChoice);
		if (discoveryBoundarySeen) {
			deferred.push({ label: command.name, reason: "afterOpaqueStep" });
			continue;
		}

		if (role.collect.kind === "scanChoice") {
			const choice = role.collect.choice;
			discoveryBoundarySeen = isDiscoveryInputBoundary(choice, seededValue);
			if (choice.onePageInput === "never") {
				deferred.push({ label: choice.name, reason: "choiceOptedOut" });
			} else if (opaqueSeen) {
				deferred.push({ label: choice.name, reason: "afterOpaqueStep" });
			} else {
				members.push({
					kind: "choice",
					occurrenceId: command.id,
					choice,
					group: groupForChoice(choice),
				});
			}
		} else if (role.collect.kind === "scriptInputs") {
			members.push({
				kind: "script",
				occurrenceId: command.id,
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
