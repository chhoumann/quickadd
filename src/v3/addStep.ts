import type IChoice from "../types/choices/IChoice";
import { uuidv4 } from "../utils/uuid";
import { legacyTypeOf, lowerNode } from "./lower";
import { migrateChoice } from "./migrate";
import { type Action, RUN_NOTE, type Step } from "./model";

export type NewStepKind = "runScript" | "open" | "link" | "templater" | "wait";

const STEP_NAMES = { open: "Open the note", link: "Link it", templater: "Run Templater" } as const;

/**
 * A step as the macro builder adds the matching command, migrated: a script
 * with no file yet, a short wait, and an open, a link and a Templater run on
 * the run note (the note the write ended on, which is what a step added to a
 * Template or Capture is for). The link goes on a new line in the current note.
 */
export function newStep(kind: NewStepKind): Step {
	const id = uuidv4();
	switch (kind) {
		case "runScript":
			return { id, name: "Script", type: "runScript", path: "", settings: {} };
		case "open":
			return { id, name: STEP_NAMES.open, type: "open", note: RUN_NOTE, location: "reuse", direction: "vertical", mode: "default", focus: true };
		case "link":
			return { id, name: STEP_NAMES.link, type: "link", link: RUN_NOTE, insert: { placement: "newLine", requireActiveFile: false } };
		case "templater":
			return { id, name: STEP_NAMES.templater, type: "templater", note: RUN_NOTE };
		case "wait":
			return { id, name: "Wait", type: "wait", time: 100 };
	}
}

/** What a step's row is called: its own name, or what its kind is called. */
export function stepName(step: Step): string {
	const own = typeof step.name === "string" ? step.name.trim() : "";
	if (own) return own;
	return step.type in STEP_NAMES ? STEP_NAMES[step.type as keyof typeof STEP_NAMES] : "";
}

/**
 * `choice` with `step` added at the end, as the choice its action now lowers
 * to. A Template or Capture becomes a Macro under the same id whose first
 * command carries the write, with its link, open and Templater settings. The
 * write keeps the action's id (see lowerSteps) and shows the action's name.
 */
export function withStep(choice: IChoice, step: Step): IChoice {
	const { node } = migrateChoice(choice);
	if (node.kind === "folder") throw new Error(`'${choice.name}' is a folder, which has no steps.`);
	const steps = legacyTypeOf(node) === "Macro" ? node.steps : withWriteNamed(node);
	return lowerNode({ ...node, steps: [...steps, step] });
}

function withWriteNamed(action: Action): Step[] {
	return action.steps.map((step) => (step.id === action.id ? { ...step, name: step.name ?? action.name } : step));
}
