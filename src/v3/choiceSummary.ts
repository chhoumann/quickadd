import type IChoice from "../types/choices/IChoice";
import { childChoicesOf, flattenChoices, hasUnreadableChildren, isChoiceLike } from "../utils/choiceUtils";
import { migrateChoice } from "./migrate";
import { describeStepsLine, summarize } from "./summary";

/**
 * The line shown under a choice's name in the settings list and the launcher.
 * A choice reads as the action it migrates to; a folder reads as its size.
 * `all` is the whole tree, to name the choices a Run action step points at.
 */
export function summarizeChoice(choice: IChoice, all: IChoice[]): string {
	if (choice.type === "Multi") {
		// The folder says it could not be read; a count would contradict that.
		if (hasUnreadableChildren(choice)) return "";
		const count = childChoicesOf(choice).filter(isChoiceLike).length;
		return count === 0 ? "No choices yet" : count === 1 ? "1 choice" : `${count} choices`;
	}
	try {
		const { node } = migrateChoice(choice);
		if (node.kind !== "action") return "";
		return summarize(node, namesOf(all));
	} catch {
		// data.json is untrusted; a choice we cannot read gets no line, not a crash.
		return "";
	}
}

/**
 * The line under a step's row in the sequence builder: what the macro command
 * does, as the steps it migrates to (a nested Capture that opens its note is
 * two). Null for a command this version cannot read, whose row says nothing.
 */
export function describeCommand(command: unknown, all: IChoice[]): string | null {
	const host = { id: "", name: "", type: "Macro", command: false, macro: { id: "", name: "", commands: [command] } };
	try {
		const { node } = migrateChoice(host as unknown as IChoice);
		if (node.kind !== "action" || node.steps.length === 0) return null;
		if (node.steps.some((step) => step.type === "unknown")) return null;
		return describeStepsLine(node.steps, namesOf(all));
	} catch {
		return null;
	}
}

function namesOf(all: IChoice[]): (id: string) => string | undefined {
	const names = new Map(flattenChoices(all).map((entry) => [entry.id, entry.name]));
	return (id) => names.get(id);
}
