import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, ButtonComponent, Notice } from "obsidian";
import type { AIProvider, Model } from "src/ai/Provider";
import { settingsStore } from "src/settingsStore";

// Each discovery call gets its own deferred so a test can decide which request
// (the quiet on-open sync or "Sync now") lands first.
const discovery = vi.hoisted(() => {
	const calls: Array<{ resolve: (models: Model[]) => void }> = [];
	return {
		calls,
		discoverProviderModels: () =>
			new Promise<Model[]>((resolve) => calls.push({ resolve })),
	};
});

vi.mock("src/ai/modelDiscoveryService", () => ({
	discoverProviderModels: discovery.discoverProviderModels,
}));
vi.mock("./GenericInputPrompt/GenericInputPrompt", () => ({
	default: { Prompt: vi.fn() },
}));
vi.mock("./GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	default: { Prompt: vi.fn().mockResolvedValue(true) },
}));

import { AIAssistantProvidersModal } from "./AIAssistantProvidersModal";

const SHIPPED: Model[] = [
	{ name: "gpt-5.5", maxTokens: 1_050_000, maxOutputTokens: 128_000, supportsTemperature: false },
];
const DIRECTORY: Model[] = [
	...SHIPPED,
	{ name: "gpt-6-sol", maxTokens: 1_050_000, maxOutputTokens: 128_000, supportsTemperature: false },
];

function openAIProvider(): AIProvider {
	return {
		id: "openai",
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		apiKey: "",
		models: SHIPPED.map((model) => ({ ...model })),
		autoSyncModels: true,
		modelSource: "modelsDev",
	};
}

function clickButtonByText(modal: AIAssistantProvidersModal, text: string) {
	const button = Array.from(
		modal.contentEl.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Button "${text}" not found`);
	button.click();
}

// The stub Setting renders settingEl > infoEl > nameEl without Obsidian's
// classes, so read each model row's name structurally.
function shownModelNames(modal: AIAssistantProvidersModal): string[] {
	return Array.from(
		modal.contentEl.querySelectorAll(
			".models-container > div > div:first-child > div:first-child",
		),
	)
		.map((el) => el.textContent ?? "")
		.filter((name) => name !== "Add model");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Resolve the nth discovery request once it has actually been made. */
async function landDiscovery(index: number, models: Model[]): Promise<void> {
	await flush();
	const call = discovery.calls[index];
	if (!call) throw new Error(`Discovery request #${index} was never made`);
	call.resolve(models);
	await flush();
}
const notices = () =>
	(Notice as unknown as { instances: Array<{ message: string }> }).instances.map(
		(notice) => notice.message,
	);

// Regression: the quiet on-open sync used to merge new models into the
// provider being edited without re-rendering, so "Sync now" then revealed
// them while reporting "already up to date" (reproduced in Obsidian 1.13.7).
describe("AIAssistantProvidersModal model sync while editing", () => {
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

	beforeEach(() => {
		discovery.calls.length = 0;
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;
		settingsStore.setState({ disableOnlineFeatures: false });
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	function openAndEdit(providers: AIProvider[]): AIAssistantProvidersModal {
		const modal = new AIAssistantProvidersModal(providers, new App() as App);
		clickButtonByText(modal, "Edit");
		return modal;
	}

	it("shows models the on-open sync adds after the provider was opened", async () => {
		const modal = openAndEdit([openAIProvider()]);
		expect(shownModelNames(modal)).toEqual(["gpt-5.5"]);

		await landDiscovery(0, DIRECTORY);

		expect(shownModelNames(modal)).toEqual(["gpt-5.5", "gpt-6-sol"]);
	});

	it("says 'already up to date' only when the list on screen really is", async () => {
		const modal = openAndEdit([openAIProvider()]);
		await landDiscovery(0, DIRECTORY);

		clickButtonByText(modal, "Sync now");
		await landDiscovery(1, DIRECTORY);

		expect(notices()).toEqual([
			"Synced from the models.dev directory: already up to date.",
		]);
	});

	it("counts models the on-open sync lands after Sync now was clicked", async () => {
		const modal = openAndEdit([openAIProvider()]);

		// Click while the on-open sync is still in flight; it then lands first.
		clickButtonByText(modal, "Sync now");
		await landDiscovery(0, DIRECTORY);
		await landDiscovery(1, DIRECTORY);

		expect(notices()).toEqual([
			"Synced from the models.dev directory: 1 new model(s), 0 updated.",
		]);
		expect(shownModelNames(modal)).toEqual(["gpt-5.5", "gpt-6-sol"]);
	});

	it("does not count a model the user adds while Sync now waits", async () => {
		const providers = [openAIProvider()];
		const modal = openAndEdit(providers);

		clickButtonByText(modal, "Sync now");
		providers[0].models.push({ name: "my-local-model", maxTokens: 8192 });
		await landDiscovery(0, DIRECTORY);
		await landDiscovery(1, DIRECTORY);

		expect(notices()).toEqual([
			"Synced from the models.dev directory: 1 new model(s), 0 updated.",
		]);
		expect(providers[0].models.map((model) => model.name)).toEqual([
			"gpt-5.5",
			"my-local-model",
			"gpt-6-sol",
		]);
	});

	it("keeps background-synced models when the user cancels their edits", async () => {
		const providers = [openAIProvider()];
		const modal = openAndEdit(providers);
		providers[0].name = "Renamed by user";

		await landDiscovery(0, DIRECTORY);
		clickButtonByText(modal, "Cancel");

		expect(providers[0].name).toBe("OpenAI");
		expect(providers[0].models.map((model) => model.name)).toEqual([
			"gpt-5.5",
			"gpt-6-sol",
		]);
	});

	it("does not sync or notice after Cancel while Sync now awaits background sync", async () => {
		const providers = [openAIProvider()];
		const modal = openAndEdit(providers);

		clickButtonByText(modal, "Sync now");
		clickButtonByText(modal, "Cancel");
		await landDiscovery(0, DIRECTORY);
		await flush();

		// Sync now must not sync or announce anything for the discarded copy...
		expect(discovery.calls).toHaveLength(1);
		expect(notices()).toEqual([]);
		// ...and the background result lands on the snapshot Cancel restored.
		expect(providers[0].models.map((model) => model.name)).toEqual([
			"gpt-5.5",
			"gpt-6-sol",
		]);
	});

	it("keeps Sync now results when the user cancels afterwards", async () => {
		const providers = [openAIProvider()];
		const modal = openAndEdit(providers);
		await landDiscovery(0, SHIPPED);

		clickButtonByText(modal, "Sync now");
		await landDiscovery(1, DIRECTORY);
		providers[0].name = "Renamed by user";
		clickButtonByText(modal, "Cancel");

		expect(providers[0].name).toBe("OpenAI");
		expect(providers[0].models.map((model) => model.name)).toEqual([
			"gpt-5.5",
			"gpt-6-sol",
		]);
	});

	it("still syncs when the user saves while Sync now waits", async () => {
		const providers = [openAIProvider()];
		const modal = openAndEdit(providers);

		clickButtonByText(modal, "Sync now");
		clickButtonByText(modal, "Save");
		await landDiscovery(0, SHIPPED);
		await landDiscovery(1, DIRECTORY);

		expect(notices()).toEqual([
			"Synced from the models.dev directory: 1 new model(s), 0 updated.",
		]);
		expect(providers[0].models.map((model) => model.name)).toEqual([
			"gpt-5.5",
			"gpt-6-sol",
		]);
	});
});
