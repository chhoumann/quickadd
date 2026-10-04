import { describe, expect, it, vi, afterEach } from "vitest";

const { editorChoices } = vi.hoisted(() => ({ editorChoices: { names: [] as string[] } }));

vi.mock("./CommandSequenceEditor", () => ({
	CommandSequenceEditor: class {
		constructor(options: { choices: { name: string }[] }) {
			editorChoices.names = options.choices.map((choice) => choice.name);
		}

		render(parent: HTMLElement) {
			const editor = document.createElement("div");
			editor.className = "quickAddCommandEditor";
			editor.textContent = "Mock command editor";
			parent.appendChild(editor);
		}

		destroy() {}
	},
}));

import { App } from "obsidian";
import type QuickAdd from "../../main";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import { MacroChoice } from "../../types/choices/MacroChoice";
import { MacroBuilder } from "./MacroBuilder";

const plugin = { settings: { choices: [] } } as unknown as QuickAdd;

/** The builder page, displayed as Obsidian displays it when it opens. */
function openPage(choice: IMacroChoice, onSave: (choice: IMacroChoice) => void = () => {}) {
	const page = new MacroBuilder(new App(), plugin, choice, [], onSave);
	page.display();
	return page;
}

/** The rows of the page's last settings group, Behavior. */
function behaviorRows(page: MacroBuilder): Element[] {
	const groups = Array.from(page.containerEl.children);
	return Array.from(groups.at(-1)?.lastElementChild?.children ?? []);
}

describe("MacroBuilder", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("keeps the optional icon override after macro behavior settings", () => {
		const page = openPage(new MacroChoice("Macro under test"));
		const rows = behaviorRows(page);

		expect(page.containerEl.textContent).toContain("Which day");
		expect(page.containerEl.textContent).toContain("Ask each time");
		expect(rows.at(-3)?.textContent).toContain("Run on startup");
		expect(rows.at(-2)?.textContent).toContain("Add to command palette");
		expect(rows.at(-1)?.textContent).toContain("Icon");
		expect(rows.at(-1)?.textContent).toContain("Lucide/Obsidian icon id");
	});

	it("leaves the macro out of the choices its steps can run", () => {
		const choice = new MacroChoice("Macro under test");
		new MacroBuilder(new App(), plugin, choice, [choice, new MacroChoice("Other")], () => {}).display();

		expect(editorChoices.names).toEqual(["Other"]);
	});

	it("offers the pick-a-day command only once the macro is a command", () => {
		const choice = new MacroChoice("Macro under test");
		expect(openPage(choice).containerEl.textContent).not.toContain("(pick a day)");

		choice.command = true;
		expect(openPage(choice).containerEl.textContent).toContain(
			'Also add "Macro under test (pick a day)"',
		);

		choice.dateOrigin = { kind: "ask" };
		expect(openPage(choice).containerEl.textContent).not.toContain("(pick a day)");
	});

	it("edits and restores the macro one-page input override", () => {
		const choice = new MacroChoice("Macro under test");
		const page = openPage(choice);
		const select = page.containerEl.querySelector<HTMLSelectElement>("select");
		if (!select) throw new Error("Missing one-page input dropdown");
		expect(Array.from(select.options, (option) => option.text)).toEqual([
			"Follow global setting",
			"Always",
			"Never",
		]);
		expect(select.value).toBe("");

		for (const value of ["always", "never", ""]) {
			select.value = value;
			select.dispatchEvent(new Event("change"));
			expect(choice.onePageInput).toBe(value || undefined);
			const reopened = openPage(choice);
			expect(reopened.containerEl.querySelector("select")?.value).toBe(value);
		}
	});

	it("shows the ask picker default and keeps icon last", () => {
		const choice = new MacroChoice("Macro under test");
		choice.dateOrigin = { kind: "ask", defaultValue: "last week" };
		const page = openPage(choice);
		const rows = behaviorRows(page);

		expect(page.containerEl.textContent).toContain("Picker starts on");
		expect(page.containerEl.textContent).toContain("Last week");
		expect(rows.at(-2)?.textContent).toContain("Add to command palette");
		expect(rows.at(-1)?.textContent).toContain("Icon");
	});

	it("shows a custom offset only for unmatched relatives", () => {
		const choice = new MacroChoice("Macro under test");
		choice.dateOrigin = { kind: "relative", offset: -3, unit: "days" };
		const page = openPage(choice);

		expect(page.containerEl.textContent).toContain("How far from today");
		expect(page.containerEl.textContent).toContain("Custom…");
	});

	it("renames the choice and its macro from the Name field and retitles the page", () => {
		const choice = new MacroChoice("Macro under test");
		const page = openPage(choice);
		const name = page.containerEl.querySelector<HTMLInputElement>("input");
		if (!name) throw new Error("Missing Name field");
		expect(name.value).toBe("Macro under test");

		name.value = "Renamed macro";
		name.dispatchEvent(new Event("input"));

		expect(choice.name).toBe("Renamed macro");
		expect(choice.macro.name).toBe("Renamed macro");
		expect(page.title).toBe("Renamed macro");
	});

	it("saves when the page is left, keeping the old name for an empty one", () => {
		const choice = new MacroChoice("Macro under test");
		const onSave = vi.fn();
		const page = openPage(choice, onSave);
		const name = page.containerEl.querySelector<HTMLInputElement>("input");
		if (!name) throw new Error("Missing Name field");

		name.value = "  ";
		name.dispatchEvent(new Event("input"));
		expect(page.title).toBe("Macro under test");
		expect(onSave).not.toHaveBeenCalled();

		page.hide();
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave.mock.calls[0][0]).toMatchObject({
			name: "Macro under test",
			macro: { name: "Macro under test" },
		});
	});

	it("renders once, so coming back from a page over it keeps its content", () => {
		const page = openPage(new MacroChoice("Macro under test"));
		const first = page.containerEl.firstElementChild;
		page.display();
		expect(page.containerEl.firstElementChild).toBe(first);
	});
});
