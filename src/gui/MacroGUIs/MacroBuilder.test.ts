import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./CommandSequenceEditor", () => ({
	CommandSequenceEditor: class {
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
import { MacroChoice } from "../../types/choices/MacroChoice";
import { MacroBuilder } from "./MacroBuilder";

describe("MacroBuilder", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("keeps the optional icon override after macro behavior settings", () => {
		const choice = new MacroChoice("Macro under test");
		const modal = new MacroBuilder(
			new App(),
			{ settings: { choices: [] } } as unknown as QuickAdd,
			choice,
			[],
		);
		const children = Array.from(modal.contentEl.children);

		expect(modal.contentEl.textContent).toContain("Which day");
		expect(modal.contentEl.textContent).toContain("Ask each time");
		expect(children.at(-3)?.textContent).toContain("Run on startup");
		expect(children.at(-2)?.textContent).toContain("Add to command palette");
		expect(children.at(-1)?.textContent).toContain("Icon");
		expect(children.at(-1)?.textContent).toContain(
			"Lucide/Obsidian icon id",
		);
	});

	it("offers the pick-a-day command only once the macro is a command", () => {
		const choice = new MacroChoice("Macro under test");
		const plugin = { settings: { choices: [] } } as unknown as QuickAdd;
		const off = new MacroBuilder(new App(), plugin, choice, []);
		expect(off.contentEl.textContent).not.toContain("(pick a day)");

		choice.command = true;
		const on = new MacroBuilder(new App(), plugin, choice, []);
		expect(on.contentEl.textContent).toContain(
			'Also add "Macro under test (pick a day)"',
		);

		choice.dateOrigin = { kind: "ask" };
		const ask = new MacroBuilder(new App(), plugin, choice, []);
		expect(ask.contentEl.textContent).not.toContain("(pick a day)");
	});

	it("edits and restores the macro one-page input override", () => {
		const choice = new MacroChoice("Macro under test");
		const plugin = { settings: { choices: [] } } as unknown as QuickAdd;
		const modal = new MacroBuilder(new App(), plugin, choice, []);
		const select = modal.contentEl.querySelector<HTMLSelectElement>("select");
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
			const reopened = new MacroBuilder(new App(), plugin, choice, []);
			expect(reopened.contentEl.querySelector("select")?.value).toBe(value);
		}
	});

	it("shows the ask picker default and keeps icon last", () => {
		const choice = new MacroChoice("Macro under test");
		choice.dateOrigin = { kind: "ask", defaultValue: "last week" };
		const modal = new MacroBuilder(
			new App(),
			{ settings: { choices: [] } } as unknown as QuickAdd,
			choice,
			[],
		);
		const children = Array.from(modal.contentEl.children);

		expect(modal.contentEl.textContent).toContain("Picker starts on");
		expect(modal.contentEl.textContent).toContain("Last week");
		expect(children.at(-2)?.textContent).toContain("Add to command palette");
		expect(children.at(-1)?.textContent).toContain("Icon");
	});

	it("shows a custom offset only for unmatched relatives", () => {
		const choice = new MacroChoice("Macro under test");
		choice.dateOrigin = { kind: "relative", offset: -3, unit: "days" };
		const modal = new MacroBuilder(
			new App(),
			{ settings: { choices: [] } } as unknown as QuickAdd,
			choice,
			[],
		);

		expect(modal.contentEl.textContent).toContain("How far from today");
		expect(modal.contentEl.textContent).toContain("Custom…");
	});

	// #1545: the builder autosaves on close but never said so, and had no
	// completion affordance at all.
	it("pins one autosave footer that survives a content rebuild", () => {
		const modal = new MacroBuilder(
			new App(),
			{ settings: { choices: [] } } as unknown as QuickAdd,
			new MacroChoice("Macro under test"),
			[],
		);

		const footers = () =>
			Array.from(modal.modalEl.querySelectorAll(".qa-builder-footer"));
		expect(footers()).toHaveLength(1);
		expect(footers()[0].textContent).toContain(
			"Changes to this macro are saved automatically",
		);
		// Outside modal-content, so it stays put while the settings scroll.
		expect(modal.contentEl.querySelector(".qa-builder-footer")).toBeNull();

		// reload() empties contentEl and re-runs display(); the footer is neither
		// dropped nor duplicated.
		(modal as unknown as { reload: () => void }).reload();
		expect(footers()).toHaveLength(1);

		const done = footers()[0].querySelector("button") as HTMLButtonElement;
		const close = vi.spyOn(modal, "close").mockImplementation(() => {});
		done.click();
		expect(close).toHaveBeenCalledTimes(1);
	});

	// The Template and Capture builders' title (ChoiceNameHeader.svelte) shows a
	// pencil next to the name; the Macro builder's title must match it.
	it("renders the title like ChoiceNameHeader, with a pencil rename icon", () => {
		const modal = new MacroBuilder(
			new App(),
			{ settings: { choices: [] } } as unknown as QuickAdd,
			new MacroChoice("Macro under test"),
			[],
		);

		const heading = modal.contentEl.querySelector("h2");
		expect(heading?.classList.contains("choiceNameHeader")).toBe(true);

		const button = heading?.querySelector("button.qa-rename-title-button");
		expect(button?.classList.contains("choiceNameHeaderButton")).toBe(true);
		expect(button?.getAttribute("aria-label")).toBe("Rename Macro under test");
		expect(
			button?.querySelector(".choiceNameHeaderText")?.textContent,
		).toBe("Macro under test");

		const icon = button?.querySelector(".choiceNameHeaderIcon");
		expect(icon?.getAttribute("aria-hidden")).toBe("true");
		const svg = icon?.querySelector("svg");
		expect(svg?.getAttribute("data-icon")).toBe("pencil");
		expect(svg?.getAttribute("width")).toBe("16");
		// The icon is decorative: the button's visible text is still just the name.
		expect(button?.textContent).toBe("Macro under test");
	});
});
