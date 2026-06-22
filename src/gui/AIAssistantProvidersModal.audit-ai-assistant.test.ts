import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, ButtonComponent } from "obsidian";
import type { AIProvider } from "src/ai/Provider";

const mocks = vi.hoisted(() => ({
	genericInputPromptMock: vi.fn(),
}));

vi.mock("./GenericInputPrompt/GenericInputPrompt", () => ({
	default: { Prompt: mocks.genericInputPromptMock },
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

// Enter edit mode for the single provider, then return the modal so callers can
// drive the "Add Model" flow.
function openProviderEdit(providers: AIProvider[]): AIAssistantProvidersModal {
	const modal = new AIAssistantProvidersModal(providers, new App() as App);
	clickButtonByText(modal, "Edit");
	return modal;
}

// Finding: ai-assistant-provider-models-crud — Add Model previously appended a
// model with maxTokens: NaN for empty/non-numeric input and let prompt
// cancellation surface as an unhandled rejection. It must now validate and treat
// cancellation as a clean no-op.
describe("AIAssistantProvidersModal Add Model validation", () => {
	beforeAll(() => {
		const modalProto = Object.getPrototypeOf(
			AIAssistantProvidersModal.prototype,
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};

		// The shared obsidian stub's ButtonComponent lacks these chainable
		// methods; shim them locally (documented harness gap) so the providers
		// modal can render without touching the shared stub.
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

	beforeEach(() => {
		mocks.genericInputPromptMock.mockReset();
	});

	afterEach(() => {
		document.body.empty?.();
		document.body.innerHTML = "";
	});

	it("rejects a non-numeric max-tokens value instead of pushing maxTokens: NaN", async () => {
		const providers = [provider()];
		const modal = openProviderEdit(providers);

		mocks.genericInputPromptMock
			.mockResolvedValueOnce("gpt-4o") // name
			.mockResolvedValueOnce("not-a-number"); // max tokens

		clickButtonByText(modal, "Add Model");
		await vi.waitFor(() =>
			expect(mocks.genericInputPromptMock).toHaveBeenCalledTimes(2),
		);
		// Let the onClick continuation run.
		await Promise.resolve();
		await Promise.resolve();

		expect(providers[0].models).toHaveLength(0);
	});

	it("rejects a numeric value with a trailing suffix (e.g. '10abc') rather than coercing it", async () => {
		const providers = [provider()];
		const modal = openProviderEdit(providers);

		mocks.genericInputPromptMock
			.mockResolvedValueOnce("gpt-4o") // name
			.mockResolvedValueOnce("10abc"); // parseInt would coerce this to 10

		clickButtonByText(modal, "Add Model");
		await vi.waitFor(() =>
			expect(mocks.genericInputPromptMock).toHaveBeenCalledTimes(2),
		);
		await Promise.resolve();
		await Promise.resolve();

		expect(providers[0].models).toHaveLength(0);
	});

	it("rejects an empty model name", async () => {
		const providers = [provider()];
		const modal = openProviderEdit(providers);

		mocks.genericInputPromptMock
			.mockResolvedValueOnce("   ") // blank name
			.mockResolvedValueOnce("8000");

		clickButtonByText(modal, "Add Model");
		await vi.waitFor(() =>
			expect(mocks.genericInputPromptMock).toHaveBeenCalledTimes(2),
		);
		await Promise.resolve();
		await Promise.resolve();

		expect(providers[0].models).toHaveLength(0);
	});

	it("treats prompt cancellation as a clean no-op (no unhandled rejection)", async () => {
		const providers = [provider()];
		const modal = openProviderEdit(providers);

		mocks.genericInputPromptMock
			.mockResolvedValueOnce("gpt-4o")
			.mockRejectedValueOnce(new Error("No input given."));

		clickButtonByText(modal, "Add Model");
		await vi.waitFor(() =>
			expect(mocks.genericInputPromptMock).toHaveBeenCalledTimes(2),
		);
		await Promise.resolve();
		await Promise.resolve();

		expect(providers[0].models).toHaveLength(0);
	});

	it("adds a valid model with a positive integer max-tokens", async () => {
		const providers = [provider()];
		const modal = openProviderEdit(providers);

		mocks.genericInputPromptMock
			.mockResolvedValueOnce("gpt-4o")
			.mockResolvedValueOnce("128000");

		clickButtonByText(modal, "Add Model");
		await vi.waitFor(() =>
			expect(mocks.genericInputPromptMock).toHaveBeenCalledTimes(2),
		);
		await Promise.resolve();
		await Promise.resolve();

		await vi.waitFor(() => expect(providers[0].models).toHaveLength(1));
		expect(providers[0].models[0]).toEqual({
			name: "gpt-4o",
			maxTokens: 128000,
		});
	});
});
