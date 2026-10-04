import { describe, expect, it } from "vitest";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import { ChoiceCommand } from "../types/macros/ChoiceCommand";
import { summarizeChoice } from "./choiceSummary";

const folder = (children: IChoice[]): IMultiChoice => new MultiChoice("Folder").addChoices(children);

describe("summarizeChoice", () => {
	it("counts a folder's direct children", () => {
		const nested = folder([new CaptureChoice("a"), new CaptureChoice("b")]);
		expect(summarizeChoice(folder([]), [])).toBe("No choices yet");
		expect(summarizeChoice(folder([new CaptureChoice("a")]), [])).toBe("1 choice");
		expect(summarizeChoice(folder([nested, new CaptureChoice("c")]), [])).toBe("2 choices");
	});

	it("says nothing about a folder whose children it cannot read", () => {
		const broken = { ...folder([]), choices: { a: 1 } } as unknown as IChoice;
		expect(summarizeChoice(broken, [])).toBe("");
	});

	it("names the choice a Run action step points at, wherever it sits in the tree", () => {
		const target = new CaptureChoice("Inbox");
		const macro = new MacroChoice("Morning");
		macro.macro.commands.push(new ChoiceCommand("Inbox", target.id));
		expect(summarizeChoice(macro, [folder([target]), macro])).toBe("Runs 'Inbox'");
	});

	it("returns nothing, rather than throwing, for a choice it cannot read", () => {
		const unknownType = { id: "x", name: "Odd", type: "Spreadsheet", command: false } as unknown as IChoice;
		expect(summarizeChoice(unknownType, [])).toBe("");
	});
});
