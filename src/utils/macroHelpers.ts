import QuickAdd from "src/main";
import { CommandType } from "src/types/macros/CommandType";
import type { IChoiceCommand } from "src/types/macros/IChoiceCommand";
import type { ICommand } from "src/types/macros/ICommand";
import type { IConditionalCommand } from "src/types/macros/Conditional/IConditionalCommand";
import { getConditionSummary } from "./conditionalHelpers";

export function getCommandDisplayName(cmd: ICommand): string {
	if (cmd.type === CommandType.Choice) {
		try {
			return QuickAdd.instance.getChoiceById((cmd as IChoiceCommand).choiceId)
				.name;
		} catch {
			return "(missing choice)";
		}
	}

	if (cmd.type === CommandType.Conditional) {
		const condition = (cmd as IConditionalCommand).condition;
		return `If ${getConditionSummary(condition)}`;
	}

	return cmd.name;
}
