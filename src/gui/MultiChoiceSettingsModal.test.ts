import { beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import { MultiChoiceSettingsModal } from "./MultiChoiceSettingsModal";
import type IMultiChoice from "../types/choices/IMultiChoice";

function makeMultiChoice(overrides: Partial<IMultiChoice> = {}): IMultiChoice {
	return {
		id: "multi",
		name: "Multi",
		type: "Multi",
		command: false,
		collapsed: false,
		choices: [],
		...overrides,
	};
}

function selectDisplayMode(modal: MultiChoiceSettingsModal, value: string) {
	const dropdown = modal.containerEl.querySelector("select");
	expect(dropdown).toBeInstanceOf(HTMLSelectElement);
	dropdown!.value = value;
	dropdown!.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickSave(modal: MultiChoiceSettingsModal) {
	const saveButton = Array.from(
		modal.containerEl.querySelectorAll("button"),
	).find((button) => button.textContent === "Save");
	expect(saveButton).toBeInstanceOf(HTMLButtonElement);
	saveButton!.click();
}

beforeEach(() => {
	document.body.empty();
});

describe("MultiChoiceSettingsModal", () => {
	it("persists the opt-in context-menu display mode", async () => {
		const choice = makeMultiChoice();
		const modal = new MultiChoiceSettingsModal(new App(), choice);

		selectDisplayMode(modal, "context-menu");
		clickSave(modal);

		await expect(modal.waitForClose).resolves.toMatchObject({
			displayMode: "context-menu",
		});
	});

	it("omits the default choice-picker mode from saved choices", async () => {
		const choice = makeMultiChoice({ displayMode: "context-menu" });
		const modal = new MultiChoiceSettingsModal(new App(), choice);

		selectDisplayMode(modal, "suggester");
		clickSave(modal);

		await expect(modal.waitForClose).resolves.toMatchObject({
			displayMode: undefined,
		});
	});
});
