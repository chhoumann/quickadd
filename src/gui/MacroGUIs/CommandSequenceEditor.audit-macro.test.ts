import { testApp } from "../../../tests/helpers/settings/modalApp";
import { collectUnhandledRejections } from "../../../tests/helpers/unhandledRejections";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Notice, prepareFuzzySearch, TFile } from "obsidian";
import { openAddStepMenu } from "../../../tests/helpers/settings/addStepMenu";
import type QuickAdd from "../../main";
import { CommandSequenceEditor } from "./CommandSequenceEditor";
import InputSuggester from "../InputSuggester/inputSuggester";
import { promptCancelled } from "../../errors/UserCancelError";
import { log } from "../../logger/logManager";

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string }>;
};
const noticeClass = Notice as unknown as NoticeTestClass;


/** Pick Run a script from the editor's Add a step menu. */
function runAScript(container: HTMLElement) {
	openAddStepMenu(container).pick("Run a script");
}

describe("CommandSequenceEditor script typed with its export", () => {
	beforeEach(() => {
		noticeClass.instances.length = 0;
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("warns when a typed script name resolves to nothing", async () => {
		vi.spyOn(InputSuggester, "Suggest").mockResolvedValue("missingScript::run");
		const app = testApp();
		const script = new TFile();
		script.path = "Scripts/ask.js";
		script.name = "ask.js";
		script.basename = "ask";
		script.extension = "js";
		app.vault.getFiles = () => [script];
		const onCommandsChange = vi.fn();
		const editor = new CommandSequenceEditor({
			app,
			plugin: { settings: { choices: [] } } as unknown as QuickAdd,
			commands: [],
			choices: [],
			onCommandsChange,
		});
		const container = document.createElement("div");
		document.body.appendChild(container);
		editor.render(container);

		runAScript(container);
		await vi.waitFor(() =>
			expect(noticeClass.instances.some((n) => n.message.includes("missingScript::run"))).toBe(true),
		);
		expect(onCommandsChange).not.toHaveBeenCalled();

		editor.destroy();
	});
});

/**
 * Obsidian drops a menu item's click promise, so pressing Escape in the script
 * picker must not be an unhandled rejection, which Obsidian's dev:errors lists
 * as `MacroAbortError: Input cancelled by user`.
 */
describe("CommandSequenceEditor script picker (Run a script)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function renderEditor() {
		const app = testApp();
		const script = new TFile();
		script.path = "Scripts/ask.js";
		script.name = "ask.js";
		script.basename = "ask";
		script.extension = "js";
		app.vault.getFiles = () => [script];

		const onCommandsChange = vi.fn();
		const editor = new CommandSequenceEditor({
			app,
			plugin: { settings: { choices: [] } } as unknown as QuickAdd,
			commands: [],
			choices: [],
			onCommandsChange,
		});
		const container = document.createElement("div");
		document.body.appendChild(container);
		editor.render(container);
		return { editor, container, onCommandsChange };
	}

	it("stays quiet when the user dismisses the picker", async () => {
		const suggest = vi
			.spyOn(InputSuggester, "Suggest")
			.mockRejectedValue(promptCancelled());
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const { editor, container, onCommandsChange } = renderEditor();

		const unhandled = await collectUnhandledRejections(async () => runAScript(container));

		expect(suggest).toHaveBeenCalledTimes(1);
		expect(unhandled).toEqual([]);
		expect(logError).not.toHaveBeenCalled();
		expect(onCommandsChange).not.toHaveBeenCalled();
		editor.destroy();
	});

	it("reports a real failure with context instead of leaving it unhandled", async () => {
		vi.spyOn(InputSuggester, "Suggest").mockRejectedValue(new Error("picker broke"));
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const { editor, container } = renderEditor();

		const unhandled = await collectUnhandledRejections(async () => runAScript(container));

		expect(unhandled).toEqual([]);
		expect(logError).toHaveBeenCalledTimes(1);
		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Couldn't add that step: picker broke",
		);
		editor.destroy();
	});

	it("adds the script picked", async () => {
		vi.spyOn(InputSuggester, "Suggest").mockResolvedValue("Scripts/ask.js");
		const { editor, container, onCommandsChange } = renderEditor();

		runAScript(container);
		await vi.waitFor(() => expect(onCommandsChange).toHaveBeenCalledTimes(1));

		expect(onCommandsChange.mock.calls[0][0]).toMatchObject([
			{ name: "ask", path: "Scripts/ask.js" },
		]);
		editor.destroy();
	});

	// #942: several `view.js` files in different folders all rendered as "view".
	// Picking one must save that file, named by its path.
	it("tells same-named scripts apart by path", async () => {
		const app = testApp();
		const files = ["bins/views/books/view.js", "bins/views/progress-bar/view.js"].map((path) => {
			const file = new TFile();
			file.path = path;
			file.name = "view.js";
			file.basename = "view";
			file.extension = "js";
			return file;
		});
		app.vault.getFiles = () => files;
		app.vault.getAbstractFileByPath = (path: string) => files.find((file) => file.path === path) ?? null;
		let picker: InputSuggester | undefined;
		vi.spyOn(InputSuggester, "Suggest").mockImplementation((...args) => {
			picker = new InputSuggester(...args);
			return picker.promise;
		});
		const onCommandsChange = vi.fn();
		const editor = new CommandSequenceEditor({
			app,
			plugin: { settings: { choices: [] } } as unknown as QuickAdd,
			commands: [],
			choices: [],
			onCommandsChange,
		});
		const container = document.createElement("div");
		editor.render(container);

		runAScript(container);
		if (!picker) throw new Error("Script picker did not open");

		const rows = picker.getSuggestions("").map((suggestion) => {
			const el = document.createElement("div");
			picker?.renderSuggestion(suggestion, el);
			return el.textContent;
		});
		expect(new Set(rows).size).toBe(2);
		expect(rows.some((row) => row?.includes("bins/views/progress-bar"))).toBe(true);

		picker.inputEl.value = "progress";
		const matches = picker.getSuggestions("progress");
		expect(matches.map((match) => match.item)).toEqual([
			"bins/views/progress-bar/view.js",
		]);
		// The row highlights the match, here in its path. The test stub's modal
		// doesn't fuzzy-match, so match the row's search text with the scorer.
		const found = prepareFuzzySearch("progress")(picker.getItemText(matches[0].item));
		const row = document.createElement("div");
		picker.renderSuggestion({ item: matches[0].item, match: found ?? { score: 0, matches: [] } }, row);
		expect(Array.from(row.querySelectorAll(".suggestion-note .suggestion-highlight"), (span) => span.textContent))
			.toEqual(["progress"]);

		picker.selectSuggestion(matches[0], new MouseEvent("click"));
		await vi.waitFor(() => expect(onCommandsChange).toHaveBeenCalled());
		expect(onCommandsChange.mock.lastCall?.[0]).toEqual([
			expect.objectContaining({
				name: "bins/views/progress-bar/view.js",
				path: "bins/views/progress-bar/view.js",
			}),
		]);
		editor.destroy();
	});
});
