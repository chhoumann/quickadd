import { beforeAll, describe, expect, it } from "vitest";
import { App } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { PROVIDER_PRESETS } from "src/ai/providerPresets";
import { ProviderPickerModal } from "./ProviderPickerModal";

function findButtonByText(modal: ProviderPickerModal, text: string): HTMLButtonElement {
	const button = Array.from(
		modal.contentEl.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Button "${text}" not found`);
	return button;
}

// Finding: ai-assistant-provider-presets — Connect/Add-custom previously kept the
// picker open (only a transient Notice) and pushed duplicates with no guard.
// Connect/Add now close after a successful add and Connect refuses a duplicate
// (same name + endpoint).
describe("ProviderPickerModal add behavior", () => {
	beforeAll(() => {
		const modalProto = Object.getPrototypeOf(
			ProviderPickerModal.prototype,
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};
	});

	it("closes the picker after adding a custom provider (no stay-open duplicate footgun)", () => {
		const providers: AIProvider[] = [];
		const modal = new ProviderPickerModal(new App() as App, providers);

		const stillAttachedBefore = document.body.contains(modal.containerEl);
		expect(stillAttachedBefore).toBe(true);

		findButtonByText(modal, "Add custom...").click();

		expect(providers).toHaveLength(1);
		// close() removes the modal container from the DOM in the stub.
		expect(document.body.contains(modal.containerEl)).toBe(false);
	});

	it("refuses to add a preset provider that is already configured", () => {
		const preset = PROVIDER_PRESETS[0];
		const providers: AIProvider[] = [
			{
				name: preset.name,
				endpoint: preset.endpoint,
				apiKey: "",
				apiKeyRef: "existing-key",
				models: [],
				modelSource: "providerApi",
			},
		];

		const modal = new ProviderPickerModal(new App() as App, providers);

		// Provide a key for the first preset card so the key-required guard passes.
		const firstCard = modal.contentEl.querySelector(".qa-provider-card");
		const keyInput = firstCard?.querySelector<HTMLInputElement>("input");
		if (keyInput) {
			keyInput.value = "another-key";
			keyInput.dispatchEvent(new Event("input"));
		}

		const connectButtons = Array.from(
			modal.contentEl.querySelectorAll<HTMLButtonElement>("button"),
		).filter((b) => b.textContent === "Connect");
		// Assert the button exists so the test can't pass for the wrong reason
		// (a missing button silently no-op'ing the click).
		expect(connectButtons[0]).toBeDefined();
		connectButtons[0].click();

		// Still only the one pre-existing provider; the duplicate was refused.
		expect(providers).toHaveLength(1);
	});
});
