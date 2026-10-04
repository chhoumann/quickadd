import type IChoice from "../types/choices/IChoice";
import { uuidv4 } from "../utils/uuid";
import { legacyTypeOf, lowerNode } from "./lower";
import { migrateChoice } from "./migrate";
import type { Action, Step } from "./model";

export type NewStepKind = "runScript" | "open" | "wait";

/**
 * A step as the macro builder adds the matching command, migrated: a script
 * with no file yet, an open of a note still to choose, a short wait.
 */
export function newStep(kind: NewStepKind): Step {
	const id = uuidv4();
	switch (kind) {
		case "runScript":
			return { id, name: "Script", type: "runScript", path: "", settings: {} };
		case "open":
			return { id, name: "Open file", type: "open", note: "", location: "reuse", direction: "vertical", mode: "default", focus: true };
		case "wait":
			return { id, name: "Wait", type: "wait", time: 100 };
	}
}

/**
 * `choice` with `step` added at the end, as the choice its action now lowers
 * to. A Template or Capture becomes a Macro under the same id whose first
 * command carries the write, with its link, open and Templater settings.
 */
export function withStep(choice: IChoice, step: Step): IChoice {
	const { node } = migrateChoice(choice);
	if (node.kind === "folder") throw new Error(`'${choice.name}' is a folder, which has no steps.`);
	const steps = legacyTypeOf(node) === "Macro" ? node.steps : asFirstStep(node);
	return lowerNode({ ...node, steps: [...steps, step] });
}

/**
 * A Template's or Capture's steps as the start of a sequence. The write and
 * its follow-ups carry the action's id, which the nested choice they lower to
 * would then share with the Macro around it, and a run would take it for the
 * Macro calling itself. So they get an id of their own, and the write shows
 * the action's name.
 */
function asFirstStep(action: Action): Step[] {
	const id = uuidv4();
	return action.steps.map((step) => {
		if (step.id === action.id) return { ...step, id, name: step.name ?? action.name };
		const suffix = step.id.startsWith(`${action.id}:`) ? step.id.slice(action.id.length) : null;
		return suffix ? { ...step, id: `${id}${suffix}` } : step;
	});
}
