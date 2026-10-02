import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { fireEvent } from "@testing-library/svelte";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { MultiChoiceBuilder } from "./MultiChoiceBuilder";

function appWithSuggestSupport(): App {
	const app = new App() as App & {
		dom: { appContainerEl: HTMLElement };
		keymap: { pushScope: () => void; popScope: () => void };
	};
	app.dom = { appContainerEl: document.body };
	app.keymap = { pushScope: vi.fn(), popScope: vi.fn() };
	return app;
}

function multiChoice(icon?: string): IMultiChoice {
	return {
		id: "multi-1",
		name: "Workflows",
		type: "Multi",
		command: false,
		collapsed: false,
		choices: [],
		icon,
	};
}

/** The folder's page, displayed as Obsidian displays it when it opens. */
function openPage(choice: IMultiChoice) {
	const onSave = vi.fn();
	const page = new MultiChoiceBuilder(appWithSuggestSupport(), choice, onSave);
	page.display();
	const [name, placeholder, icon] = Array.from(
		page.containerEl.querySelectorAll<HTMLInputElement>("input"),
	);
	return { page, onSave, name, placeholder, icon };
}

describe("MultiChoiceBuilder", () => {
	it("edits the icon and saves it when the page is left", async () => {
		const { page, onSave, icon } = openPage(multiChoice());

		expect(icon.placeholder).toBe("folder");
		expect(
			page.containerEl.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "folder");

		await fireEvent.input(icon, { target: { value: "folder-open" } });
		expect(
			page.containerEl.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "folder-open");
		expect(onSave).not.toHaveBeenCalled();

		page.hide();
		expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ icon: "folder-open" }));
	});

	it("renames the folder, retitling the page, and keeps the old name for an empty one", async () => {
		const { page, onSave, name } = openPage(multiChoice());

		await fireEvent.input(name, { target: { value: " Daily " } });
		expect(page.title).toBe("Daily");
		page.save();
		expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Daily" }));

		await fireEvent.input(name, { target: { value: "  " } });
		expect(page.title).toBe("Workflows");
		page.hide();
		expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Workflows" }));
	});

	it("shows the folder name the empty Placeholder field falls back to", async () => {
		const { name, placeholder } = openPage(multiChoice());

		expect(placeholder.placeholder).toBe("Workflows");

		await fireEvent.input(name, { target: { value: "Daily" } });
		expect(placeholder.placeholder).toBe("Daily");

		await fireEvent.input(name, { target: { value: "  " } });
		expect(placeholder.placeholder).toBe("Workflows");
	});

	it("clears a blank icon override back to the default", async () => {
		const { page, onSave, icon } = openPage(multiChoice("star"));

		expect(icon.value).toBe("star");

		await fireEvent.input(icon, { target: { value: "   " } });
		expect(
			page.containerEl.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "folder");

		page.hide();
		expect(onSave.mock.calls[0][0].icon).toBeUndefined();
	});
});
