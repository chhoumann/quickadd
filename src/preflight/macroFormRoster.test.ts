import { describe, expect, it } from "vitest";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IChoice from "src/types/choices/IChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { IChoiceCommand } from "src/types/macros/IChoiceCommand";
import type { ICommand } from "src/types/macros/ICommand";
import type { IUserScript } from "src/types/macros/IUserScript";
import type { IConditionalCommand } from "src/types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "src/types/macros/QuickCommands/INestedChoiceCommand";
import { buildFormRoster } from "./macroFormRoster";

function captureChoice(
	id: string,
	overrides: Partial<ICaptureChoice> = {},
): ICaptureChoice {
	return {
		id,
		name: id,
		type: "Capture",
		command: false,
		captureTo: "Projects",
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: false,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: false, format: "" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "",
		},
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		...overrides,
	};
}

function nestedChoice(choice: IChoice): INestedChoiceCommand {
	return {
		id: `nested-${choice.id}`,
		name: choice.name,
		type: CommandType.NestedChoice,
		choice,
	};
}

function userScript(id: string, path = `${id}.js`): IUserScript {
	return {
		id,
		name: id,
		type: CommandType.UserScript,
		path,
		settings: {},
	};
}

function choiceCommand(id: string, name: string, choiceId: string): IChoiceCommand {
	return {
		id,
		name,
		type: CommandType.Choice,
		choiceId,
	};
}

function conditionalCommand(
	id: string,
	name: string,
	thenCommands: ICommand[],
): IConditionalCommand {
	return {
		id,
		name,
		type: CommandType.Conditional,
		condition: {
			mode: "variable",
			variableName: "x",
			operator: "isTruthy",
			valueType: "boolean",
		},
		thenCommands,
		elseCommands: [],
	};
}

function macroChoice(...commands: ICommand[]): IMacroChoice {
	return {
		id: "macro-choice",
		name: "Macro Choice",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "macro-choice",
			name: "Macro Choice",
			commands,
		},
	};
}

function noChoices(): (id: string) => IChoice | null {
	return () => null;
}

describe("buildFormRoster", () => {
	it("collects this-level NestedChoice captures and does not flatten a nested Macro", () => {
		const outer = captureChoice("outer-cap", { name: "Outer capture" });
		const buried = captureChoice("buried-cap", { name: "Buried capture" });
		const nestedMacro: IMacroChoice = {
			id: "inner-macro",
			name: "Inner macro",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "inner-macro",
				name: "Inner macro",
				commands: [nestedChoice(buried)],
			},
		};
		const roster = buildFormRoster(
			noChoices(),
			macroChoice(nestedChoice(outer), nestedChoice(nestedMacro)),
		);

		expect(
			roster.members
				.filter((entry) => entry.kind === "choice")
				.map((entry) => entry.choice.id),
		).toEqual(["outer-cap"]);
		expect(roster.deferred.map((entry) => entry.label)).toEqual(["Inner macro"]);
	});

	it("does not enter a Conditional then-branch", () => {
		const thenCapture = captureChoice("then-cap", { name: "Then capture" });
		const roster = buildFormRoster(
			noChoices(),
			macroChoice(conditionalCommand("cond", "If project", [nestedChoice(thenCapture)])),
		);

		expect(roster.members).toEqual([]);
		expect(
			roster.members
				.filter((entry) => entry.kind === "choice")
				.map((entry) => entry.choice.id),
		).not.toContain("then-cap");
	});

	it("excludes a nested Capture with onePageInput never", () => {
		const optedOut = captureChoice("never-cap", {
			name: "Private capture",
			onePageInput: "never",
		});
		const kept = captureChoice("kept-cap", { name: "Public capture" });
		const roster = buildFormRoster(
			noChoices(),
			macroChoice(nestedChoice(optedOut), nestedChoice(kept)),
		);

		expect(
			roster.members
				.filter((entry) => entry.kind === "choice")
				.map((entry) => entry.choice.id),
		).toEqual(["kept-cap"]);
		expect(
			roster.members
				.filter((entry) => entry.kind === "choice")
				.map((entry) => entry.choice.id),
		).not.toContain("never-cap");
	});

	it("collects the first capture and UserScript, and defers a later capture after opaque", () => {
		const first = captureChoice("cap-1", { name: "First capture" });
		const second = captureChoice("cap-2", { name: "Second capture" });
		const roster = buildFormRoster(
			noChoices(),
			macroChoice(nestedChoice(first), userScript("script-1"), nestedChoice(second)),
		);

		expect(roster.members.map((entry) => entry.kind)).toEqual([
			"choice",
			"script",
		]);
		expect(roster.members[0]).toMatchObject({
			kind: "choice",
			choice: { id: "cap-1" },
		});
		expect(roster.members[1]).toMatchObject({
			kind: "script",
			command: { id: "script-1" },
		});
		expect(
			roster.members
				.filter((entry) => entry.kind === "choice")
				.map((entry) => entry.choice.id),
		).toEqual(["cap-1"]);
	});

	it("still hoists later UserScript inputs after an opaque script", () => {
		const roster = buildFormRoster(
			noChoices(),
			macroChoice(userScript("script-a"), userScript("script-b")),
		);

		expect(roster.members.map((entry) => entry.kind)).toEqual([
			"script",
			"script",
		]);
		expect(roster.deferred).toEqual([]);
	});

	it("collects a Choice command Capture when resolveChoice returns it", () => {
		const capture = captureChoice("cap-ref", { name: "Referenced capture" });
		const roster = buildFormRoster(
			(id) => (id === capture.id ? capture : null),
			macroChoice(choiceCommand("choice-cmd", "Run capture", capture.id)),
		);

		expect(roster.members).toEqual([
			expect.objectContaining({
				kind: "choice",
				choice: expect.objectContaining({ id: "cap-ref" }),
				group: { id: "cap-ref", label: "Referenced capture" },
			}),
		]);
		expect(roster.deferred).toEqual([]);
	});

	it("does not collect a dangling Choice command", () => {
		const roster = buildFormRoster(
			noChoices(),
			macroChoice(choiceCommand("choice-cmd", "Missing capture", "missing-id")),
		);

		expect(roster.members).toEqual([]);
		expect(roster.deferred.map((entry) => entry.label)).toEqual(["Missing capture"]);
	});

});
