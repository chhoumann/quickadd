import { describe, expect, it, vi } from "vitest";
import { CommandType } from "../types/macros/CommandType";

vi.mock("src/logger/logManager", () => ({
	log: {
		logMessage: vi.fn(),
		logError: vi.fn(),
	},
}));

import backfillFileOpeningDefaults from "./backfillFileOpeningDefaults";

type TestChoice = {
	id: string;
	name: string;
	type: "Capture" | "Template" | "Macro" | "Multi";
	fileOpening?: unknown;
	openFileInNewTab?: unknown;
	openFileInMode?: unknown;
	choices?: TestChoice[];
	macro?: {
		id: string;
		name: string;
		commands: unknown[];
	};
};

describe("backfillFileOpeningDefaults migration", () => {
	it("backfills missing fileOpening across nested choices and legacy settings", async () => {
		const captureLegacy: TestChoice = {
			id: "capture-legacy",
			name: "Capture Legacy",
			type: "Capture",
			openFileInNewTab: {
				enabled: true,
				direction: "horizontal",
				focus: false,
			},
			openFileInMode: "source",
		};
		const captureMissing: TestChoice = {
			id: "capture-missing",
			name: "Capture Missing",
			type: "Capture",
		};
		const templatePartial: TestChoice = {
			id: "template-partial",
			name: "Template Partial",
			type: "Template",
			fileOpening: {
				location: "window",
			},
		};
		const nestedCapture: TestChoice = {
			id: "nested-capture",
			name: "Nested Capture",
			type: "Capture",
		};
		const nestedTemplate: TestChoice = {
			id: "nested-template",
			name: "Nested Template",
			type: "Template",
		};
		const conditionalCapture: TestChoice = {
			id: "conditional-capture",
			name: "Conditional Capture",
			type: "Capture",
		};
		const conditionalElseTemplate: TestChoice = {
			id: "conditional-else-template",
			name: "Conditional Else Template",
			type: "Template",
		};
		const legacyMacroCapture: TestChoice = {
			id: "legacy-macro-capture",
			name: "Legacy Macro Capture",
			type: "Capture",
		};

		const multiChoice: TestChoice = {
			id: "multi",
			name: "Multi",
			type: "Multi",
			choices: [nestedCapture],
		};

		const macroWithNested: TestChoice = {
			id: "macro-nested",
			name: "Macro Nested",
			type: "Macro",
			macro: {
				id: "macro-nested-id",
				name: "Macro Nested",
				commands: [
					{
						type: CommandType.NestedChoice,
						choice: nestedTemplate,
					},
				],
			},
		};

		const macroWithConditional: TestChoice = {
			id: "macro-conditional",
			name: "Macro Conditional",
			type: "Macro",
			macro: {
				id: "macro-conditional-id",
				name: "Macro Conditional",
				commands: [
					{
						type: CommandType.Conditional,
						thenCommands: [
							{
								type: CommandType.NestedChoice,
								choice: conditionalCapture,
							},
						],
						elseCommands: [
							{
								type: CommandType.NestedChoice,
								choice: conditionalElseTemplate,
							},
						],
					},
				],
			},
		};

		const plugin = {
			settings: {
				choices: [
					captureLegacy,
					captureMissing,
					templatePartial,
					multiChoice,
					macroWithNested,
					macroWithConditional,
				],
				macros: [
					{
						id: "legacy-macro",
						name: "Legacy Macro",
						commands: [
							{
								type: CommandType.NestedChoice,
								choice: legacyMacroCapture,
							},
						],
					},
				],
				migrations: {},
			},
			saveSettings: vi.fn(),
		} as any;

		await backfillFileOpeningDefaults.migrate(plugin);

		expect(captureLegacy.fileOpening).toEqual({
			location: "split",
			direction: "horizontal",
			mode: "source",
			focus: false,
		});
		expect(captureMissing.fileOpening).toEqual({
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		});
		expect(templatePartial.fileOpening).toEqual({
			location: "window",
			direction: "vertical",
			mode: "default",
			focus: true,
		});
		expect(nestedCapture.fileOpening).toEqual({
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		});
		expect(nestedTemplate.fileOpening).toEqual({
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		});
		expect(conditionalCapture.fileOpening).toEqual({
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		});
		expect(conditionalElseTemplate.fileOpening).toEqual({
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		});
		expect(legacyMacroCapture.fileOpening).toEqual({
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		});
		expect(plugin.saveSettings).toHaveBeenCalled();
	});
});
