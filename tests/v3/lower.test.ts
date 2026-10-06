import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { CommandType } from "../../src/types/macros/CommandType";
import type { INestedChoiceCommand } from "../../src/types/macros/QuickCommands/INestedChoiceCommand";
import type { IOpenFileCommand } from "../../src/types/macros/QuickCommands/IOpenFileCommand";
import { compactGroup, legacyTypeOf, lowerNode } from "../../src/v3/lower";
import { migrateChoice } from "../../src/v3/migrate";
import type { Action, OpenStep, Step } from "../../src/v3/model";
import { RUN_NOTE, V3_STEP_COMMAND } from "../../src/v3/model";

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

	it.each([
		["link", { id: "my-link", type: "link", link: RUN_NOTE, copyToClipboard: true }],
		["templater", { id: "my-templater", type: "templater", note: RUN_NOTE }],
		["open with a view mode", { id: "my-open", type: "open", note: RUN_NOTE, location: "tab", direction: "vertical", mode: "preview", focus: true }],
	] as [string, Step][])("lowers a %s step of the user's own to a step command, which migrates back to the step", (_, own) => {
		const action = captureThatOpens();
		const lowered = lowerNode({ ...action, steps: [action.steps[0]!, own] }) as IMacroChoice;
		expect(lowered.type).toBe("Macro");
		expect(lowered.macro.commands[1]).toEqual({ id: own.id, name: "", type: V3_STEP_COMMAND, step: own });
		const steps = (migrateChoice(lowered).node as Action).steps;
		expect(steps.map((step) => step.id)).toEqual([action.id, own.id]);
		expect(steps[1]).toEqual(own);
	});

	it("lowers a step command inside an if branch and reads it back", () => {
		const link: Step = { id: "link", type: "link", link: RUN_NOTE, copyToClipboard: true };
		const branch: Step = {
			id: "if",
			type: "if",
			condition: { mode: "variable", variableName: "x", operator: "isTruthy", valueType: "boolean" },
			thenSteps: [link],
			elseSteps: [],
		};
		const action: Action = { ...captureThatOpens(), steps: [branch] };
		expect((migrateChoice(lowerNode(action)).node as Action).steps).toEqual([branch]);
	});

	it("still cannot lower a step type it does not know", () => {
		const action = captureThatOpens();
		const future = { id: "future", type: "future" } as unknown as Step;
		expect(() => lowerNode({ ...action, steps: [action.steps[0]!, future] })).toThrow("no v2 encoding");
	});
});

describe("lowering a Template or Capture that became a sequence", () => {
	it("gives the nested choice an id of its own and reads the write back under the action's id", () => {
		const action = captureThatOpens();
		const wait: Step = { id: "wait", name: "Wait", type: "wait", time: 100 };
		const sequence: Action = { ...action, steps: [{ ...action.steps[0]!, name: "Log" }, action.steps[1]!, wait] };

		const lowered = lowerNode(sequence) as IMacroChoice;
		const nested = lowered.macro.commands[0] as INestedChoiceCommand;
		expect(lowered).toMatchObject({ id: action.id, type: "Macro" });
		expect(nested.choice.id).toBe(`${action.id}:choice`);
		expect(nested.choice).toMatchObject({ type: "Capture", openFile: true });

		const steps = (migrateChoice(lowered).node as Action).steps;
		expect(steps.map((step) => step.id)).toEqual([action.id, `${action.id}:open`, "wait"]);
	});

	it("keeps the id of a write that is not the action's own", () => {
		const action = captureThatOpens();
		const write = { ...action.steps[0]!, id: "write", name: "Log" };
		const lowered = lowerNode({ ...action, steps: [write, { id: "wait", name: "Wait", type: "wait", time: 100 }] }) as IMacroChoice;
		expect((lowered.macro.commands[0] as INestedChoiceCommand).choice.id).toBe("write");
		expect((migrateChoice(lowered).node as Action).steps.map((step) => step.id)).toEqual(["write", "wait"]);
	});
});
