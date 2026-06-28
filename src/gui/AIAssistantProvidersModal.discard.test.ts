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

// A provider shaped like the built-in defaults: no apiKeyRef key at all.
function providerWithoutApiKeyRef(): AIProvider {
	return {
		name: "Custom",
		endpoint: "https://api.custom.ai/v1",
		apiKey: "",
		models: [],
		modelSource: "providerApi",
	};
}

function providerWithModels(): AIProvider {
	return {
		name: "Custom",
		endpoint: "https://api.custom.ai/v1",
		apiKey: "",
		apiKeyRef: "",
		models: [{ name: "m1", maxTokens: 1000 }],
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

// Select a SecretStorage entry in the edit form. The API-key SecretComponent is
// the only empty-valued text input in edit mode (Name/Endpoint are non-empty,
// the auto-sync toggle is a checkbox).
function setApiKeyRefInEditForm(
	modal: AIAssistantProvidersModal,
	value: string,
) {
	const secretInput = Array.from(
		modal.contentEl.querySelectorAll<HTMLInputElement>("input"),
	).find((el) => el.type === "text" && el.value === "");
	if (!secretInput) throw new Error("API Key (secret) input not found");
	secretInput.value = value;
	secretInput.dispatchEvent(new Event("input", { bubbles: true }));
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

	it("discards an apiKeyRef added during edit on Cancel (a key the snapshot lacked)", () => {
		const providers = [providerWithoutApiKeyRef()];
		const modal = openProviderEdit(providers);

		setApiKeyRefInEditForm(modal, "secret-ref-123");
		expect(providers[0].apiKeyRef).toBe("secret-ref-123"); // live during edit

		clickButtonByText(modal, "Cancel");

		// Object.assign(provider, snapshot) could not remove apiKeyRef because the
		// snapshot never had it; the snapshot-restore must.
		expect(providers[0].apiKeyRef).toBeUndefined();
		expect("apiKeyRef" in providers[0]).toBe(false);
	});

	it("discards an apiKeyRef added during edit on dismiss (Escape/X)", () => {
		const providers = [providerWithoutApiKeyRef()];
		const modal = openProviderEdit(providers);

		setApiKeyRefInEditForm(modal, "secret-ref-123");
		modal.close();

		expect(providers[0].apiKeyRef).toBeUndefined();
	});

	it("discards nested model edits on Cancel", () => {
		const providers = [providerWithModels()];
		const modal = openProviderEdit(providers);

		// The Add Model flow mutates selectedProvider.models in place; simulate it.
		providers[0].models.push({ name: "leaked", maxTokens: 5 });

		clickButtonByText(modal, "Cancel");

		expect(providers[0].models).toEqual([{ name: "m1", maxTokens: 1000 }]);
	});
});
