import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App, ButtonComponent } from "obsidian";
import type { AIProvider } from "src/ai/Provider";

vi.mock("./GenericInputPrompt/GenericInputPrompt", () => ({
	default: { Prompt: vi.fn() },
}));
vi.mock("./GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	default: { Prompt: vi.fn().mockResolvedValue(true) },
}));

import { AIAssistantProvidersModal } from "./AIAssistantProvidersModal";

function provider(): AIProvider {
	return {
		name: "Custom",
		endpoint: "https://api.custom.ai/v1",
		apiKey: "",
		apiKeyRef: "",
		models: [],
		modelSource: "providerApi",
	};
}

function clickButtonByText(modal: AIAssistantProvidersModal, text: string) {
	const button = Array.from(
		modal.contentEl.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Button "${text}" not found`);
	button.click();
}

function openProviderEdit(providers: AIProvider[]): AIAssistantProvidersModal {
	const modal = new AIAssistantProvidersModal(providers, new App() as App);
	clickButtonByText(modal, "Edit");
	return modal;
}

// Type the new provider name into the edit form's Name field (the only input
// whose value matches the current name) and fire the onChange the modal listens
// for.
function renameInEditForm(
	modal: AIAssistantProvidersModal,
	currentName: string,
	nextName: string,
) {
	const nameInput = Array.from(
		modal.contentEl.querySelectorAll<HTMLInputElement>("input"),
	).find((el) => el.value === currentName);
	if (!nameInput) throw new Error(`Name input for "${currentName}" not found`);
	nameInput.value = nextName;
	nameInput.dispatchEvent(new Event("input", { bubbles: true }));
}

// Finding: ai-assistant-providers-cancel-discard — Cancel/Escape while editing a
// provider must discard the in-progress edits (restoring the snapshot taken on
// Edit), not persist them. Earlier code left the mutated provider in the array.
describe("AIAssistantProvidersModal discards edits on cancel/dismiss", () => {
	beforeAll(() => {
		const modalProto = Object.getPrototypeOf(
			AIAssistantProvidersModal.prototype,
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};

		const btnProto = ButtonComponent.prototype as unknown as {
			setDestructive?: () => unknown;
			setIcon?: () => unknown;
		};
		btnProto.setDestructive ??= function setDestructive(this: unknown) {
			return this;
		};
		btnProto.setIcon ??= function setIcon(this: unknown) {
			return this;
		};
	});

	afterEach(() => {
		document.body.empty?.();
		document.body.innerHTML = "";
	});

	it("restores the original provider when Cancel is clicked", () => {
		const providers = [provider()];
		const modal = openProviderEdit(providers);

		renameInEditForm(modal, "Custom", "Renamed");
		expect(providers[0].name).toBe("Renamed"); // edit is live until cancelled

		clickButtonByText(modal, "Cancel");

		expect(providers[0].name).toBe("Custom");
	});

	it("restores the original provider when the modal is dismissed (Escape/X)", () => {
		const providers = [provider()];
		const modal = openProviderEdit(providers);

		renameInEditForm(modal, "Custom", "Renamed");
		expect(providers[0].name).toBe("Renamed");

		// close() runs onClose — the Escape/X dismissal path.
		modal.close();

		expect(providers[0].name).toBe("Custom");
	});

	it("keeps the edit when Save is clicked", () => {
		const providers = [provider()];
		const modal = openProviderEdit(providers);

		renameInEditForm(modal, "Custom", "Renamed");
		clickButtonByText(modal, "Save");

		expect(providers[0].name).toBe("Renamed");
	});
});
