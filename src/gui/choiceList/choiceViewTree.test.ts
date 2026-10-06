import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import type IChoice from "../../types/choices/IChoice";
import { MacroChoice } from "../../types/choices/MacroChoice";
import { MultiChoice } from "../../types/choices/MultiChoice";
import { replaceChoiceHelper } from "./choiceViewTree";

function macroFor(choice: IChoice): MacroChoice {
	return Object.assign(new MacroChoice(choice.name), { id: choice.id });
}

describe("replaceChoiceHelper", () => {
	it("swaps a choice for one of another type, keeping none of the old keys", () => {
		const capture = new CaptureChoice("Log");
		const macro = macroFor(capture);
		const replaced = replaceChoiceHelper(capture, macro);
		expect(replaced).toBe(macro);
		expect(replaced).not.toHaveProperty("captureTo");
		expect(replaced).not.toHaveProperty("format");
	});

	it("finds the choice inside a folder and leaves the rest as it was", () => {
		const capture = new CaptureChoice("Log");
		const other = new CaptureChoice("Other");
		const folder = new MultiChoice("Folder");
		folder.choices = [other, capture];
		const macro = macroFor(capture);

		const replaced = replaceChoiceHelper(folder, macro) as MultiChoice;
		expect(replaced).not.toBe(folder);
		expect(replaced.choices[0]).toBe(other);
		expect(replaced.choices[1]).toBe(macro);
		expect(folder.choices[1]).toBe(capture);
	});

	it("leaves a folder whose list it cannot read alone", () => {
		const folder = Object.assign(new MultiChoice("Folder"), { choices: "not a list" });
		const capture = new CaptureChoice("Log");
		expect(replaceChoiceHelper(folder, macroFor(capture))).toBe(folder);
	});
});
