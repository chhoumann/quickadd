import { getQuickAddInstance } from "src/quickAddInstance";
import { CommandType } from "src/types/macros/CommandType";
import type { IChoiceCommand } from "src/types/macros/IChoiceCommand";
import type { ICommand } from "src/types/macros/ICommand";
import type { IConditionalCommand } from "src/types/macros/Conditional/IConditionalCommand";
import { getConditionSummary } from "./conditionalHelpers";
import { stepName } from "src/v3/addStep";
import { V3_STEP_COMMAND, type V3StepCommand } from "src/v3/model";

export function getCommandDisplayName(cmd: ICommand): string {
	if (cmd.type === CommandType.Choice) {
		try {
			return getQuickAddInstance().getChoiceById((cmd as IChoiceCommand).choiceId)
				.name;
		} catch {
			return "(missing choice)";
		}
	}

	if (cmd.type === CommandType.Conditional) {
		const condition = (cmd as IConditionalCommand).condition;
		return `If ${getConditionSummary(condition)}`;
	}

	if ((cmd.type as string) === V3_STEP_COMMAND) {
		const step = (cmd as unknown as V3StepCommand).step;
		if (typeof step === "object" && step !== null) return stepName(step);
	}

	return cmd.name;
}
