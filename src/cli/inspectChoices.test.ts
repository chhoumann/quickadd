import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import type QuickAdd from "../main";
import { createTemplateChoice } from "../../tests/helpers/preflight/choices";

// Mock the heavy leaves of the executor's import graph (mirrors
// choiceExecutor.onePageGate.test.ts).
vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("../main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));

const { checkChoiceHandler } = await import("./inspectChoices");

describe("quickadd:check", () => {
	it("leaves out a template file's {{VALUE:title}}, which the note's title fills", async () => {
		const template = Object.assign(new TFile(), { path: "Templates/Meeting.md", extension: "md" });
		const app = {
			workspace: { getActiveFile: () => null },
			vault: {
				getAbstractFileByPath: (path: string) => (path === template.path ? template : null),
				cachedRead: async () => "# {{VALUE:Title}}\nWith {{VALUE:Who}}",
			},
			metadataCache: { getFileCache: () => null },
		} as unknown as App;
		const choice = {
			...createTemplateChoice(template.path),
			name: "Meeting note",
			fileNameFormat: { enabled: true, format: "{{VALUE}}" },
		};
		const plugin = {
			app,
			settings: { inputPrompt: "single-line", globalVariables: {}, choices: [choice] },
			getChoiceByName: () => choice,
		} as unknown as QuickAdd;

		const result = await checkChoiceHandler(plugin, { choice: "Meeting note" });

		expect(result).toMatchObject({ missingFlags: ["value-value=<value>", "value-Who=<value>"] });
	});
});
