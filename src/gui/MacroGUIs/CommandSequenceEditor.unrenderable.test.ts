import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import type QuickAdd from "../../main";
import type { ICommand } from "../../types/macros/ICommand";
import { CommandSequenceEditor } from "./CommandSequenceEditor";
import { log } from "../../logger/logManager";

function testApp(): App {
	const app = new App() as App & {
		dom: { appContainerEl: HTMLElement };
		keymap: { pushScope: () => void; popScope: () => void };
	};
	app.dom = { appContainerEl: document.body };
	app.keymap = { pushScope: vi.fn(), popScope: vi.fn() };
	return app;
}

function renderEditor(commands: unknown, onCommandsChange = vi.fn()) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const editor = new CommandSequenceEditor({
		app: testApp(),
		plugin: {} as unknown as QuickAdd,
		commands: commands as ICommand[],
		choices: [],
		onCommandsChange,
	});
	editor.render(container);
	return { container, editor, onCommandsChange };
}

/**
 * #1584 follow-through. Once mountComponent stopped letting a broken CommandList
 * take the macro builder down with it, the builder started OPENING over a list it
 * could not draw - and every add control was still live. Two ways that goes wrong:
 *
 *   - `commands: null` (the issue's own live repro): every add control throws
 *     `[...null]` inside its click handler. Dead buttons, silently.
 *   - a valid array with duplicate ids: `{#each ... (command.id)}` throws
 *     `each_key_duplicate`, so the list is invisible - but the add controls WORK,
 *     appending commands the user cannot see, review or delete, and persisting
 *     them on close.
 *
 * A list we could not draw must not be edited blind.
 */
describe("CommandSequenceEditor over an unrenderable command list (#1584)", () => {
	const addControlCount = (container: HTMLElement) =>
		container.querySelectorAll("button").length;

	it("shows the error card instead of the list", () => {
		vi.spyOn(log, "logError").mockImplementation(() => {});
		const { container } = renderEditor(null);

		const card = container.querySelector(".qaMountFailed");
		expect(card?.textContent).toContain(
			"QuickAdd couldn't display this macro's commands",
		);
		vi.restoreAllMocks();
	});

	it("offers no control that would edit the list it could not draw", () => {
		vi.spyOn(log, "logError").mockImplementation(() => {});
		const { container } = renderEditor(null);

		// The quick-command bar and the four "Add …" rows are all gone.
		expect(addControlCount(container)).toBe(0);
		expect(container.querySelector(".quickCommandContainer")).toBeNull();
		expect(container.textContent).not.toContain("Obsidian command");
		expect(container.textContent).not.toContain("User scripts");
		vi.restoreAllMocks();
	});

	it("cannot append to a list the user cannot see", () => {
		vi.spyOn(log, "logError").mockImplementation(() => {});
		// A valid array, so nothing throws on append - only the RENDER fails. This is
		// the shape where an ungated editor silently persists invisible commands.
		const duplicateIds = [
			{ id: "dup", name: "One", type: "Wait" },
			{ id: "dup", name: "Two", type: "Wait" },
		];
		const { container, onCommandsChange } = renderEditor(duplicateIds);

		expect(container.querySelector(".qaMountFailed")).not.toBeNull();
		expect(addControlCount(container)).toBe(0);
		expect(onCommandsChange).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("still builds the whole editor when the list renders", () => {
		const { container } = renderEditor([
			{ id: "wait-1", name: "Wait", type: "Wait", time: 100 },
		]);

		expect(container.querySelector(".qaMountFailed")).toBeNull();
		expect(container.querySelector(".quickCommandContainer")).not.toBeNull();
		expect(addControlCount(container)).toBeGreaterThan(0);
	});
});
