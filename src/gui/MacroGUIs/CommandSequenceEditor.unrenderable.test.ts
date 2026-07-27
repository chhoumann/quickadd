import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import type QuickAdd from "../../main";
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
		commands,
		choices: [],
		onCommandsChange,
	});
	const editable = editor.render(container);
	return { container, editor, onCommandsChange, editable };
}

const addControlCount = (container: HTMLElement) =>
	container.querySelectorAll("button").length;
const rowCount = (container: HTMLElement) =>
	container.querySelectorAll(".quickAddCommandList > li").length;

const wait = (id: string, time = 100) => ({ id, name: "Wait", type: "Wait", time });

/**
 * The macro editor's three states over `macro.commands` from data.json (#1593).
 *
 * #1584 stopped a broken command list from taking the macro builder down with
 * it, but every malformed shape then landed in the same place: an error card
 * with no controls, i.e. a macro that could only be repaired by hand-editing
 * data.json. That is honest for a value we genuinely cannot read; it is far too
 * blunt for the two shapes that are a perfectly good array with one bad entry,
 * and for the shapes that carry nothing at all.
 */
describe("CommandSequenceEditor over a malformed command list (#1593)", () => {
	describe("a readable array with a bad entry stays fully editable", () => {
		it("renders both commands when two share an id, keeping the second", () => {
			const { container, editable } = renderEditor([
				wait("dup", 100),
				wait("dup", 200),
			]);

			expect(editable).toBe(true);
			expect(container.querySelector(".qaMountFailed")).toBeNull();
			expect(rowCount(container)).toBe(2);
			expect(addControlCount(container)).toBeGreaterThan(0);
		});

		it("renders a command that has no id at all", () => {
			const { container, editable } = renderEditor([
				{ name: "Readwise sync", type: "UserScript", path: "s.js" },
				wait("ok"),
			]);

			expect(editable).toBe(true);
			expect(rowCount(container)).toBe(2);
		});

		it("renders the commands either side of a null hole", () => {
			const { container, editable } = renderEditor([wait("a"), null, wait("b")]);

			expect(editable).toBe(true);
			expect(rowCount(container)).toBe(2);
		});

		it("does not persist the repair until the user actually edits something", () => {
			const { onCommandsChange } = renderEditor([wait("dup"), wait("dup")]);

			// Opening a macro must not write to data.json. The re-id rides along with
			// the user's first ordinary edit instead.
			expect(onCommandsChange).not.toHaveBeenCalled();
		});
	});

	describe("a value that carries nothing opens an empty, usable editor", () => {
		it.each([
			["null", null],
			["undefined", undefined],
			["an empty object", {}],
			["an empty string", ""],
			["an empty array", []],
		])("offers the full editor for %s", (_label, commands) => {
			const { container, editable } = renderEditor(commands);

			expect(editable).toBe(true);
			expect(container.querySelector(".qaDataUnreadable")).toBeNull();
			expect(container.querySelector(".quickCommandContainer")).not.toBeNull();
			expect(addControlCount(container)).toBeGreaterThan(0);
			expect(rowCount(container)).toBe(0);
		});
	});

	describe("a value that could be carrying commands is read-only", () => {
		it.each([
			["an array-turned-object", { "0": wait("hidden") }],
			["a string", "not a list"],
			["a JSON string", '[{"id":"x","type":"Wait","name":"Wait"}]'],
			["a number", 7],
		])("shows the unreadable card and no edit controls for %s", (_label, commands) => {
			const { container, editable } = renderEditor(commands);

			expect(editable).toBe(false);
			expect(container.querySelector(".qaDataUnreadable")?.textContent).toContain(
				"QuickAdd couldn't read this macro's commands",
			);
			// Nothing that could write the `[]` we read the value as.
			expect(addControlCount(container)).toBe(0);
			expect(container.querySelector(".quickCommandContainer")).toBeNull();
			expect(container.textContent).not.toContain("Obsidian command");
			expect(container.textContent).not.toContain("User scripts");
		});

		it("says the value has not been touched, and does not ask for a bug report", () => {
			const { container } = renderEditor("not a list");
			const text = (container.textContent ?? "").replace(/\s+/g, " ");

			expect(text).toContain("will not overwrite it");
			expect(text).toContain("data.json");
			// This is the user's data, not a QuickAdd bug: MountFailed's copy would
			// send them to file an issue with no error message to put in it.
			expect(text).not.toContain("report this");
		});

		it("never emits a change for a value it could not read", () => {
			const { onCommandsChange } = renderEditor({ "0": wait("hidden") });
			expect(onCommandsChange).not.toHaveBeenCalled();
		});
	});

	describe("a genuine mount failure still withholds the controls (#1584)", () => {
		it("shows the error card instead of the list", () => {
			vi.spyOn(log, "logError").mockImplementation(() => {});
			// A component that throws on mount is the only way left to reach this arm
			// now that data shapes are handled above; simulate it by breaking the
			// props the list needs.
			const container = document.createElement("div");
			document.body.appendChild(container);
			const editor = new CommandSequenceEditor({
				app: testApp(),
				plugin: {} as unknown as QuickAdd,
				// A frozen array whose entries are getters that throw reproduces a
				// render-time explosion without depending on Svelte internals.
				commands: [
					Object.defineProperty({ id: "boom" }, "type", {
						get() {
							throw new Error("boom");
						},
						enumerable: true,
					}),
				],
				choices: [],
			});
			const editable = editor.render(container);

			expect(editable).toBe(false);
			expect(container.querySelector(".qaMountFailed")?.textContent).toContain(
				"QuickAdd couldn't display this macro's commands",
			);
			expect(addControlCount(container)).toBe(0);
			vi.restoreAllMocks();
		});
	});

	it("still builds the whole editor when the list is healthy", () => {
		const { container, editable } = renderEditor([wait("wait-1")]);

		expect(editable).toBe(true);
		expect(container.querySelector(".qaMountFailed")).toBeNull();
		expect(container.querySelector(".quickCommandContainer")).not.toBeNull();
		expect(addControlCount(container)).toBeGreaterThan(0);
	});
});
