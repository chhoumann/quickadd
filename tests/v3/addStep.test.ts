import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { CommandType } from "../../src/types/macros/CommandType";
import type { INestedChoiceCommand } from "../../src/types/macros/QuickCommands/INestedChoiceCommand";
import { WaitCommand } from "../../src/types/macros/QuickCommands/WaitCommand";
import { newStep, withStep } from "../../src/v3/addStep";
import { lowerNode } from "../../src/v3/lower";
import { migrateChoice, migrateSettingsV2 } from "../../src/v3/migrate";
import type { Action, ActionNode } from "../../src/v3/model";
import { actionsFromChoices, choicesFromActions } from "../../src/v3/storage";

function capture(): CaptureChoice {
	const choice = new CaptureChoice("Log");
	choice.captureTo = "Log.md";
	choice.appendLink = true;
	choice.openFile = true;
	return choice;
}

function template(): TemplateChoice {
	const choice = new TemplateChoice("Meeting");
	choice.templatePath = "Templates/Meeting.md";
	choice.openFile = true;
	return choice;
}

const migrated = { migrations: { migrateToV3Actions: true } };

/** The choice as its compact action lowers, as the step of a sequence. */
function loweredWrite(choice: IChoice): IChoice {
	return { ...lowerNode(migrateChoice(choice).node), command: false };
}

describe("adding a step to a choice", () => {
	for (const [type, make, follow] of [
		["Capture", capture, ["link", "open"]],
		["Template", template, ["open"]],
	] as const) {
		it(`makes a ${type} a sequence that runs its write first`, () => {
			const choice = make();
			const step = newStep("runScript");
			const converted = withStep(choice, step) as IMacroChoice;

			expect(converted).toMatchObject({ id: choice.id, name: choice.name, type: "Macro" });
			const [nested, script] = converted.macro.commands;
			expect(nested.type).toBe(CommandType.NestedChoice);
			expect(nested.name).toBe(choice.name);
			// The nested choice must not share the Macro's id, or a run would
			// take it for the Macro calling itself.
			const write = (nested as INestedChoiceCommand).choice;
			expect(write.id).toBe(`${choice.id}:choice`);
			expect(write).toEqual({ ...loweredWrite(choice), id: write.id });
			expect(script).toMatchObject({ id: step.id, type: CommandType.UserScript, path: "" });
			expect(converted.macro.commands).toHaveLength(2);

			// The write step keeps the action's id, and its follow-ups theirs.
			const steps = (migrateChoice(converted).node as Action).steps;
			expect(steps.map((entry) => entry.id)).toEqual([
				choice.id,
				...follow.map((suffix) => `${choice.id}:${suffix}`),
				step.id,
			]);
		});
	}

	it("saves the converted choice over its action, keeping what only the action holds", () => {
		const choice = capture();
		const disk = JSON.parse(JSON.stringify(migrateSettingsV2({ ...migrated, choices: [choice] }))) as { actions: Action[] };
		disk.actions[0].show.ribbon = true;
		const loaded = choicesFromActions(disk) as typeof migrated & { choices: IChoice[]; actions: ActionNode[] };
		const step = newStep("runScript");
		loaded.choices = [withStep(loaded.choices[0], step)];

		const [action] = (actionsFromChoices(loaded) as { actions: Action[] }).actions;
		expect(action).toMatchObject({ id: choice.id, show: { ribbon: true }, provenance: { migratedFrom: "Capture" } });
		expect(action.steps.map((entry) => entry.type)).toEqual(["addToNote", "link", "open", "runScript"]);
		expect(action.steps.map((entry) => entry.id)).toEqual([choice.id, `${choice.id}:link`, `${choice.id}:open`, step.id]);
		expect(action.steps[0]).toMatchObject({ name: "Log", captureTo: "Log.md" });
	});

	it("adds a command at the end of a macro", () => {
		const macro = new MacroChoice("Sequence");
		const wait = new WaitCommand(50);
		macro.macro.commands.push(wait);
		const step = newStep("wait");

		const converted = withStep(macro, step) as IMacroChoice;
		expect(converted.macro.commands.map((command) => command.id)).toEqual([wait.id, step.id]);
		expect(converted.macro.commands[1]).toMatchObject({ type: CommandType.Wait, time: 100 });
	});

	it("opens a note from the new step as an Open file command", () => {
		const step = newStep("open");
		const converted = withStep(capture(), step) as IMacroChoice;
		expect(converted.macro.commands[1]).toMatchObject({ id: step.id, type: CommandType.OpenFile, filePath: "" });
	});

	it("gives every new step its own id", () => {
		const ids = new Set((["runScript", "open", "wait", "runScript"] as const).map((kind) => newStep(kind).id));
		expect(ids.size).toBe(4);
	});
});
