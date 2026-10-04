import type IChoice from "../types/choices/IChoice";
import { childChoicesOf, flattenChoices, hasUnreadableChildren, isChoiceLike } from "../utils/choiceUtils";
import { migrateChoice } from "./migrate";
import { summarize } from "./summary";

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
		const names = new Map(flattenChoices(all).map((entry) => [entry.id, entry.name]));
		return summarize(node, (id) => names.get(id));
	} catch {
		// data.json is untrusted; a choice we cannot read gets no line, not a crash.
		return "";
	}
}
