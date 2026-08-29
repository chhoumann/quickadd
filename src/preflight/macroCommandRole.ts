import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IChoice from "src/types/choices/IChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { IChoiceCommand } from "src/types/macros/IChoiceCommand";
import type { ICommand } from "src/types/macros/ICommand";
import type { IUserScript } from "src/types/macros/IUserScript";
import type { INestedChoiceCommand } from "src/types/macros/QuickCommands/INestedChoiceCommand";

export type DeferralReason =
	| "nestedMacroGroup"
	| "interactivePicker"
	| "unresolvableChoice"
	| "conditionalBranch"
	| "choiceOptedOut"
	| "afterOpaqueStep"
	| "runsUserCode";

export type StepCollect =
	| { kind: "scanChoice"; choice: ITemplateChoice | ICaptureChoice }
	| { kind: "scriptInputs"; command: IUserScript }
	| { kind: "none" };

export interface StepRole {
	collect: StepCollect;
	opaque: DeferralReason | null;
	deferred: DeferralReason | null;
}

function noneRole(deferred: DeferralReason | null = null): StepRole {
	return { collect: { kind: "none" }, opaque: null, deferred };
}

function cutRole(reason: DeferralReason): StepRole {
	return { collect: { kind: "none" }, opaque: reason, deferred: reason };
}

export function isTemplateChoice(choice: IChoice): choice is ITemplateChoice {
	return choice.type === "Template";
}

export function isCaptureChoice(choice: IChoice): choice is ICaptureChoice {
	return choice.type === "Capture";
}

function roleForResolvedChoice(choice: IChoice | null): StepRole {
	if (!choice) return noneRole("unresolvableChoice");

	switch (choice.type) {
		case "Template":
		case "Capture":
			if (isTemplateChoice(choice) || isCaptureChoice(choice)) {
				return {
					collect: { kind: "scanChoice", choice },
					opaque: null,
					deferred: null,
				};
			}
			return noneRole("unresolvableChoice");
		case "Macro":
			return cutRole("nestedMacroGroup");
		case "Multi":
			return cutRole("interactivePicker");
		default: {
			const _exhaustive: never = choice.type;
			return _exhaustive;
		}
	}
}

export function classifyStep(
	command: ICommand,
	resolveChoice: (id: string) => IChoice | null,
): StepRole {
	switch (command.type) {
		case CommandType.NestedChoice: {
			const nested = command as INestedChoiceCommand;
			return roleForResolvedChoice(nested.choice ?? null);
		}
		case CommandType.Choice: {
			const choiceCommand = command as IChoiceCommand;
			return roleForResolvedChoice(resolveChoice(choiceCommand.choiceId));
		}
		case CommandType.UserScript:
			return {
				collect: { kind: "scriptInputs", command: command as IUserScript },
				opaque: "runsUserCode",
				deferred: null,
			};
		case CommandType.AIAssistant:
			return {
				collect: { kind: "none" },
				opaque: "runsUserCode",
				deferred: null,
			};
		case CommandType.Conditional:
			return cutRole("conditionalBranch");
		case CommandType.Obsidian:
		case CommandType.EditorCommand:
		case CommandType.Wait:
		case CommandType.OpenFile:
			return noneRole();
		default: {
			const _exhaustive: never = command.type;
			return _exhaustive;
		}
	}
}
