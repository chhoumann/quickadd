import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import type QuickAdd from "../../main";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import { MacroBuilder } from "./MacroBuilder";

function testApp(): App {
	const app = new App() as App & {
		dom: { appContainerEl: HTMLElement };
		keymap: { pushScope: () => void; popScope: () => void };
	};
	app.dom = { appContainerEl: document.body };
	app.keymap = { pushScope: vi.fn(), popScope: vi.fn() };
	return app;
}

/** The REAL CommandSequenceEditor, unlike MacroBuilder.test.ts which mocks it. */
function openBuilder(macro: unknown) {
	const choice = {
		id: "c1",
		name: "Macro under test",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro,
	} as unknown as IMacroChoice;

	const modal = new MacroBuilder(
		testApp(),
		{ settings: { choices: [] } } as unknown as QuickAdd,
		choice,
		[],
	);
	return { modal, choice, el: modal.contentEl };
}

const addControls = (el: HTMLElement) => el.querySelectorAll("button").length;
const rows = (el: HTMLElement) =>
	el.querySelectorAll(".quickAddCommandList > li").length;

/**
 * `choice.macro` is as untrusted as `macro.commands` (#1593). The shape that
 * mattered most was `macro: null`: `display()` runs from the CONSTRUCTOR, before
 * `open()`, so a throw there took the modal with it and clicking "Configure" did
 * nothing whatsoever - no card, no notice, nothing.
 */
describe("MacroBuilder over a malformed macro object (#1593)", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["an empty object", {}],
	])("opens a usable, empty editor when macro is %s", (_label, macro) => {
		const { el } = openBuilder(macro);

		expect(el.querySelector(".qaDataUnreadable")).toBeNull();
		expect(el.querySelector(".qaMountFailed")).toBeNull();
		expect(addControls(el)).toBeGreaterThan(0);
		expect(rows(el)).toBe(0);
		// The rest of the modal is there too.
		expect(el.textContent).toContain("Run on startup");
	});

	it("materializes a real macro object on the first edit, and it survives JSON", () => {
		const { modal, choice } = openBuilder(null);

		// What an "Add …" click does.
		(modal as unknown as { setMacroCommands(c: unknown[]): void }).setMacroCommands([
			{ id: "new-1", name: "Wait", type: "Wait", time: 100 },
		]);

		const persisted = JSON.parse(JSON.stringify(choice)) as IMacroChoice;
		expect(persisted.macro.commands).toHaveLength(1);
		expect(persisted.macro.commands[0].id).toBe("new-1");
		expect(persisted.macro.name).toBe("Macro under test");
		expect(typeof persisted.macro.id).toBe("string");
	});

	// An ARRAY passes `typeof === "object"`, so a looser guard let the builder
	// treat it as a macro object and write `macro.commands = [...]` onto it - a
	// non-index property that JSON.stringify drops. The user saw their commands
	// and every save silently discarded them.
	describe("an array-valued macro", () => {
		it("renders the array's entries as the commands they probably are", () => {
			const { el } = openBuilder([
				{ id: "a", name: "Alpha", type: "Wait", time: 1 },
				{ id: "b", name: "Beta", type: "Wait", time: 2 },
			]);

			expect(rows(el)).toBe(2);
			expect(addControls(el)).toBeGreaterThan(0);
		});

		it("survives the JSON round-trip after an edit, losing nothing", () => {
			const { modal, choice } = openBuilder([
				{ id: "a", name: "Alpha", type: "Wait", time: 1 },
			]);

			(modal as unknown as { setMacroCommands(c: unknown[]): void }).setMacroCommands([
				{ id: "a", name: "Alpha", type: "Wait", time: 1 },
				{ id: "b", name: "Beta", type: "Wait", time: 2 },
			]);

			const persisted = JSON.parse(JSON.stringify(choice)) as IMacroChoice;
			expect(persisted.macro.commands.map((c) => c.id)).toEqual(["a", "b"]);
		});

		it("treats an empty array as carrying nothing", () => {
			const { modal, choice, el } = openBuilder([]);

			expect(rows(el)).toBe(0);
			expect(addControls(el)).toBeGreaterThan(0);

			(modal as unknown as { setMacroCommands(c: unknown[]): void }).setMacroCommands([
				{ id: "x", name: "Wait", type: "Wait", time: 1 },
			]);
			const persisted = JSON.parse(JSON.stringify(choice)) as IMacroChoice;
			expect(persisted.macro.commands).toHaveLength(1);
		});
	});

	it.each([
		["a string", "not a macro"],
		["a number", 7],
	])("shows the unreadable card and no edit controls for %s", (_label, macro) => {
		const { el } = openBuilder(macro);

		expect(el.querySelector(".qaDataUnreadable")?.textContent).toContain(
			"QuickAdd couldn't read this macro's commands",
		);
		expect(rows(el)).toBe(0);
		// Only the rename button in the header; nothing that writes commands.
		expect(el.querySelector(".quickCommandContainer")).toBeNull();
	});

	it("leaves an unreadable macro byte-identical after open and close", () => {
		const macro = "not a macro";
		const { modal, choice } = openBuilder(macro);
		const before = JSON.stringify(choice);

		modal.onClose();

		expect(JSON.stringify(choice)).toBe(before);
	});

	it("still renames the choice when the macro object is missing", () => {
		const { modal, choice } = openBuilder(null);
		const button = modal.contentEl.querySelector<HTMLButtonElement>(
			".qa-rename-title-button",
		);

		expect(button).not.toBeNull();
		expect(choice.name).toBe("Macro under test");
	});
});
