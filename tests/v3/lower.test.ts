import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { compactGroup, legacyTypeOf, lowerNode } from "../../src/v3/lower";
import { migrateChoice } from "../../src/v3/migrate";
import type { Action, OpenStep } from "../../src/v3/model";

function captureThatOpens(): Action {
	const choice = new CaptureChoice("Log");
	choice.captureTo = "Log.md";
	choice.openFile = true;
	return migrateChoice(choice).node as Action;
}

describe("lowering a write with its follow-ups", () => {
	it("folds the open step migration derived from the choice back into it", () => {
		const action = captureThatOpens();
		expect(action.steps.map((step) => step.id)).toEqual([action.id, `${action.id}:open`]);
		expect(compactGroup(action)?.open).toBe(action.steps[1]);
		expect(legacyTypeOf(action)).toBe("Capture");
		expect(lowerNode(action)).toMatchObject({ type: "Capture", openFile: true });
	});

	it("leaves a step of the user's own on the run note as a step, and cannot lower it yet", () => {
		const action = captureThatOpens();
		const own = { ...(action.steps[1] as OpenStep), id: "my-open" };
		const withOwnOpen: Action = { ...action, steps: [action.steps[0]!, own] };
		expect(compactGroup(withOwnOpen)).toBeNull();
		expect(legacyTypeOf(withOwnOpen)).toBe("Macro");
		// A v2 command cannot open the run note, so this action is kept as it is.
		expect(() => lowerNode(withOwnOpen)).toThrow("no v2 encoding");
	});
});
