import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { CommandType } from "../../src/types/macros/CommandType";
import type { IOpenFileCommand } from "../../src/types/macros/QuickCommands/IOpenFileCommand";
import { compactGroup, legacyTypeOf, lowerNode } from "../../src/v3/lower";
import { migrateChoice } from "../../src/v3/migrate";
import type { Action, OpenStep, Step } from "../../src/v3/model";
import { RUN_NOTE } from "../../src/v3/model";

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

	it("leaves a step of the user's own on the run note as a step, and opens it with {{NOTE}}", () => {
		const action = captureThatOpens();
		const own = { ...(action.steps[1] as OpenStep), id: "my-open" };
		const withOwnOpen: Action = { ...action, steps: [action.steps[0]!, own] };
		expect(compactGroup(withOwnOpen)).toBeNull();
		expect(legacyTypeOf(withOwnOpen)).toBe("Macro");

		const lowered = lowerNode(withOwnOpen) as IMacroChoice;
		expect(lowered.macro.commands[1]).toMatchObject({ id: "my-open", type: CommandType.OpenFile, filePath: "{{NOTE}}" });
		const steps = (migrateChoice(lowered).node as Action).steps;
		expect(steps.map((step) => step.id)).toEqual([action.id, "my-open"]);
		expect(steps[1]).toEqual(own);
	});

	it("reads an Open file command on {{NOTE}}, in any case, as an open of the run note", () => {
		const macro = new MacroChoice("Open it");
		macro.macro.commands.push({ id: "open", name: "Open", type: CommandType.OpenFile, filePath: " {{note}} " } as IOpenFileCommand);
		expect((migrateChoice(macro).node as Action).steps[0]).toMatchObject({ type: "open", note: RUN_NOTE });
	});

	it.each(["link", "templater"] as const)("cannot lower a %s step of the user's own on the run note yet", (type) => {
		const action = captureThatOpens();
		const own: Step = type === "link"
			? { id: "my-link", type: "link", link: RUN_NOTE, copyToClipboard: true }
			: { id: "my-templater", type: "templater", note: RUN_NOTE };
		expect(() => lowerNode({ ...action, steps: [action.steps[0]!, own] })).toThrow("no v2 encoding");
	});
});
