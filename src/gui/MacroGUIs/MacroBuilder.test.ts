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

		expect(children.at(-2)?.textContent).toContain("Run on startup");
		expect(children.at(-1)?.textContent).toContain("Icon");
		expect(children.at(-1)?.textContent).toContain(
			"Lucide/Obsidian icon id",
		);
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
});
