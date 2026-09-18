import { describe, expect, it, vi } from "vitest";
import { legacyMacro, migrationPlugin, nestedChoice } from "../../tests/helpers/utilities/migrationFixtures";
import backfillFileOpeningDefaults from "./backfillFileOpeningDefaults";

vi.mock("src/logger/logManager", () => ({
	log: { logMessage: vi.fn(), logError: vi.fn() },
}));

type TestChoice = {
	id: string;
	name: string;
	type: "Capture" | "Template";
	fileOpening?: unknown;
	openFileInNewTab?: unknown;
	openFileInMode?: unknown;
};

function choice(
	type: TestChoice["type"],
	id: string,
	name: string,
	overrides: Partial<TestChoice> = {},
): TestChoice {
	return { type, id, name, ...overrides };
}

describe("backfillFileOpeningDefaults migration", () => {
	it("backfills missing fileOpening across nested choices and legacy settings", async () => {
		const captureLegacy = choice("Capture", "capture-legacy", "Capture Legacy", {
			openFileInNewTab: { enabled: true, direction: "horizontal", focus: false },
			openFileInMode: "source",
		});
		const captureMissing = choice("Capture", "capture-missing", "Capture Missing");
		const templatePartial = choice("Template", "template-partial", "Template Partial", {
			fileOpening: { location: "window" },
		});
		const nestedCapture = choice("Capture", "nested-capture", "Nested Capture");
		const nestedTemplate = choice("Template", "nested-template", "Nested Template");
		const conditionalCapture = choice("Capture", "conditional-capture", "Conditional Capture");
		const conditionalElseTemplate = choice("Template", "conditional-else-template", "Conditional Else Template");
		const legacyMacroCapture = choice("Capture", "legacy-macro-capture", "Legacy Macro Capture");
		const plugin = migrationPlugin({
			choices: [
				captureLegacy,
				captureMissing,
				templatePartial,
				{ id: "multi", name: "Multi", type: "Multi", choices: [nestedCapture] },
				{
					id: "macro-nested",
					name: "Macro Nested",
					type: "Macro",
					macro: legacyMacro([nestedChoice(nestedTemplate)], "macro-nested-id", "Macro Nested"),
				},
				{
					id: "macro-conditional",
					name: "Macro Conditional",
					type: "Macro",
					macro: legacyMacro([{
						type: "Conditional",
						thenCommands: [nestedChoice(conditionalCapture)],
						elseCommands: [nestedChoice(conditionalElseTemplate)],
					}], "macro-conditional-id", "Macro Conditional"),
				},
			],
			macros: [legacyMacro([nestedChoice(legacyMacroCapture)], "legacy-macro", "Legacy Macro")],
			migrations: {},
		});

		await backfillFileOpeningDefaults.migrate(plugin);

		expect(captureLegacy.fileOpening).toEqual({
			location: "split", direction: "horizontal", mode: "source", focus: false,
		});
		expect(templatePartial.fileOpening).toEqual({
			location: "window", direction: "vertical", mode: "default", focus: true,
		});
		for (const node of [
			captureMissing, nestedCapture, nestedTemplate,
			conditionalCapture, conditionalElseTemplate, legacyMacroCapture,
		]) {
			expect(node.fileOpening, node.id).toEqual({
				location: "tab", direction: "vertical", mode: "default", focus: true,
			});
		}
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
});
