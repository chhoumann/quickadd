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
});
