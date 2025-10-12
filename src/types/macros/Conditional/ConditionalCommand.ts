import { Command } from "../Command";
import { CommandType } from "../CommandType";
import type { IConditionalCommand } from "./IConditionalCommand";
import type { ConditionalCondition } from "./types";

type ConditionalCommandInit = Partial<
	Pick<IConditionalCommand, "name" | "condition" | "thenCommands" | "elseCommands">
>;

function createDefaultCondition(): ConditionalCondition {
	return {
		mode: "variable",
		variableName: "",
		operator: "isTruthy",
		valueType: "string",
	};
}

function cloneCondition(condition: ConditionalCondition): ConditionalCondition {
	return condition.mode === "variable"
		? { ...condition }
		: { ...condition };
}

export class ConditionalCommand
	extends Command
	implements IConditionalCommand
{
	condition: ConditionalCondition;
	thenCommands: IConditionalCommand["thenCommands"];
	elseCommands: IConditionalCommand["elseCommands"];

	constructor(initial?: ConditionalCommandInit) {
		super(initial?.name ?? "If condition", CommandType.Conditional);
		this.condition = initial?.condition
			? cloneCondition(initial.condition)
			: createDefaultCondition();
		this.thenCommands = initial?.thenCommands
			? [...initial.thenCommands]
			: [];
		this.elseCommands = initial?.elseCommands
			? [...initial.elseCommands]
			: [];
	}
}
