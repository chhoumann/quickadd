import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { fireEvent } from "@testing-library/svelte";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { MultiChoiceSettingsModal } from "./MultiChoiceSettingsModal";

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

function getIconInput(modal: MultiChoiceSettingsModal): HTMLInputElement {
	const input = modal.containerEl.querySelector<HTMLInputElement>(
		'input[aria-label="Choice icon"]',
	);
	if (!input) throw new Error("Choice icon input not found");
	return input;
}

function getSaveButton(modal: MultiChoiceSettingsModal): HTMLButtonElement {
	const button = Array.from(
		modal.containerEl.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => candidate.textContent === "Save");
	if (!button) throw new Error("Save button not found");
	return button;
}

describe("MultiChoiceSettingsModal", () => {
	beforeAll(() => {
		const proto = HTMLElement.prototype as unknown as {
			setText?: (text: string) => void;
		};
		proto.setText ??= function setText(this: HTMLElement, text: string) {
			this.textContent = text;
		};

		const modalProto = Object.getPrototypeOf(
			MultiChoiceSettingsModal.prototype,
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};
	});

	it("edits and persists the choice icon", async () => {
		const modal = new MultiChoiceSettingsModal(
			appWithSuggestSupport(),
			multiChoice(),
		);
		const input = getIconInput(modal);

		expect(input.placeholder).toBe("folder");
		expect(
			modal.containerEl.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "folder");

		await fireEvent.input(input, { target: { value: "folder-open" } });
		expect(
			modal.containerEl.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "folder-open");

		const result = modal.waitForClose;
		await fireEvent.click(getSaveButton(modal));

		await expect(result).resolves.toMatchObject({
			icon: "folder-open",
		});
	});

	it("clears a blank icon override back to the default", async () => {
		const modal = new MultiChoiceSettingsModal(
			appWithSuggestSupport(),
			multiChoice("star"),
		);
		const input = getIconInput(modal);

		expect(input.value).toBe("star");

		await fireEvent.input(input, { target: { value: "   " } });
		expect(
			modal.containerEl.querySelector(".qa-choice-icon-setting-preview svg"),
		).toHaveAttribute("data-icon", "folder");

		const result = modal.waitForClose;
		await fireEvent.click(getSaveButton(modal));

		await expect(result).resolves.toMatchObject({
			icon: undefined,
		});
	});
});
