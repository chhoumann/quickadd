import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, ButtonComponent } from "obsidian";
import type { AIProvider, Model } from "src/ai/Provider";
import { settingsStore } from "src/settingsStore";

const discovery = vi.hoisted(() => ({
	discoverProviderModels: vi.fn(),
}));

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

function provider(models: Model[], overrides: Partial<AIProvider> = {}): AIProvider {
	return {
		id: "openai",
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		apiKey: "",
		models,
		autoSyncModels: false,
		modelSource: "modelsDev",
		...overrides,
	};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function buttons(modal: AIAssistantProvidersModal): HTMLButtonElement[] {
	return Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"));
}

function click(modal: AIAssistantProvidersModal, text: string) {
	const button = buttons(modal).find((b) => b.textContent === text);
	if (!button) throw new Error(`Button "${text}" not found`);
	button.click();
}

// Stub Setting: settingEl > [infoEl > [nameEl, descEl], controlEl].
function modelRows(modal: AIAssistantProvidersModal): HTMLElement[] {
	return Array.from(
		modal.contentEl.querySelectorAll<HTMLElement>(".models-container > div"),
	).filter((row) => row.firstElementChild?.firstElementChild);
}

function shownModelNames(modal: AIAssistantProvidersModal): string[] {
	return modelRows(modal)
		.map((row) => row.firstElementChild!.firstElementChild!.textContent ?? "")
		.filter((name) => name !== "Add model" && !name.includes("retired model"));
}

function settingDesc(modal: AIAssistantProvidersModal, name: string): string {
	const nameEl = Array.from(modal.contentEl.querySelectorAll("div")).find(
		(el) => el.textContent === name && el.parentElement?.parentElement,
	);
	return nameEl?.nextElementSibling?.textContent ?? "";
}

function openEdit(providers: AIProvider[]): AIAssistantProvidersModal {
	const modal = new AIAssistantProvidersModal(providers, new App() as App);
	click(modal, "Edit");
	return modal;
}

const GPT4O: Model = { name: "gpt-4o", maxTokens: 128_000, releaseDate: "2024-05-13" };
const GPT6: Model = { name: "gpt-6-sol", maxTokens: 1_050_000, releaseDate: "2026-09-22" };
const O4MINI: Model = { name: "o4-mini", maxTokens: 200_000, releaseDate: "2025-04-16", deprecated: true };

describe("AIAssistantProvidersModal model list and connection UX", () => {
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
		discovery.discoverProviderModels.mockReset();
		settingsStore.setState({ disableOnlineFeatures: false });
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("lists models newest first with retired ones last, without reordering storage", () => {
		const providers = [provider([GPT4O, O4MINI, GPT6])];
		const modal = openEdit(providers);

		expect(shownModelNames(modal)).toEqual(["gpt-6-sol", "gpt-4o", "o4-mini"]);
		expect(providers[0].models.map((m) => m.name)).toEqual(["gpt-4o", "o4-mini", "gpt-6-sol"]);
	});

	it("deletes the model whose row was clicked, not the one at that stored index", async () => {
		const providers = [provider([GPT4O, GPT6])];
		const modal = openEdit(providers);

		// Row 0 on screen is gpt-6-sol, but stored index 0 is gpt-4o.
		modelRows(modal)[0].querySelector("button")!.click();
		await flush();

		expect(providers[0].models.map((m) => m.name)).toEqual(["gpt-4o"]);
	});

	it("filters the list by name", () => {
		const modal = openEdit([provider([GPT4O, O4MINI, GPT6])]);
		const filter = modal.contentEl.querySelector<HTMLInputElement>('input[type="search"]')!;

		filter.value = "GPT";
		filter.dispatchEvent(new Event("input"));

		expect(shownModelNames(modal)).toEqual(["gpt-6-sol", "gpt-4o"]);
	});

	it("removes only retired models on request, and Cancel brings them back", async () => {
		const providers = [provider([GPT4O, O4MINI, GPT6])];
		const modal = openEdit(providers);

		click(modal, "Remove retired models (1)");
		await flush();

		expect(providers[0].models.map((m) => m.name)).toEqual(["gpt-4o", "gpt-6-sol"]);
		expect(buttons(modal).some((b) => b.textContent?.startsWith("Remove retired"))).toBe(false);

		click(modal, "Cancel");
		expect(providers[0].models.map((m) => m.name)).toEqual(["gpt-4o", "o4-mini", "gpt-6-sol"]);
	});

	it("removes only the retired names confirmed, not ones marked retired while the prompt is open", async () => {
		const yesNo = await import("./GenericYesNoPrompt/GenericYesNoPrompt");
		let resolveConfirm!: (value: boolean) => void;
		vi.mocked(yesNo.default.Prompt).mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					resolveConfirm = resolve;
				}),
		);

		const providers = [provider([GPT4O, O4MINI, GPT6])];
		const modal = openEdit(providers);
		click(modal, "Remove retired models (1)");
		await flush();

		// In-flight sync marks gpt-4o retired while the confirm is open.
		providers[0].models = providers[0].models.map((model) =>
			model.name === "gpt-4o" ? { ...model, deprecated: true } : model,
		);

		resolveConfirm(true);
		await flush();

		expect(providers[0].models.map((m) => m.name)).toEqual(["gpt-4o", "gpt-6-sol"]);
		expect(providers[0].models.find((m) => m.name === "gpt-4o")?.deprecated).toBe(true);
	});

	it("deletes by model name after a sync replaces the closed-over object", async () => {
		const yesNo = await import("./GenericYesNoPrompt/GenericYesNoPrompt");
		let resolveConfirm!: (value: boolean) => void;
		vi.mocked(yesNo.default.Prompt).mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					resolveConfirm = resolve;
				}),
		);

		const providers = [provider([GPT4O, GPT6])];
		const modal = openEdit(providers);

		// Row 0 is gpt-6-sol (newest first). Click delete, then replace objects.
		modelRows(modal)[0].querySelector("button")!.click();
		await flush();
		providers[0].models = providers[0].models.map((model) => ({ ...model }));

		resolveConfirm(true);
		await flush();

		expect(providers[0].models.map((m) => m.name)).toEqual(["gpt-4o"]);
	});

	it("tests the connection against the provider's own endpoint, even for a models.dev provider", async () => {
		discovery.discoverProviderModels.mockResolvedValue([GPT4O, GPT6, O4MINI]);
		const modal = openEdit([provider([GPT4O])]);

		click(modal, "Test connection");
		await flush();

		expect(discovery.discoverProviderModels).toHaveBeenCalledWith(
			expect.objectContaining({ modelSource: "providerApi" }),
			"",
		);
		expect(settingDesc(modal, "Connection")).toContain(
			"✓ Connected. The provider lists 3 model(s).",
		);
	});

	it("shows the provider's error when the connection test fails", async () => {
		discovery.discoverProviderModels.mockRejectedValue(
			new Error("OpenAI request failed (HTTP 401): Incorrect API key provided"),
		);
		const modal = openEdit([provider([GPT4O])]);

		click(modal, "Test connection");
		await flush();

		expect(settingDesc(modal, "Connection")).toContain(
			"✗ OpenAI request failed (HTTP 401): Incorrect API key provided (No API key is linked.)",
		);
	});

	it("clears a stale sync status and connection result when the endpoint changes", async () => {
		discovery.discoverProviderModels.mockResolvedValue([GPT4O]);
		const providers = [
			provider([GPT4O], { lastModelSync: { at: Date.now() - 60_000 } }),
		];
		const modal = openEdit(providers);
		click(modal, "Test connection");
		await flush();
		expect(settingDesc(modal, "Auto-sync models")).toContain("Last synced 1 minute ago");
		expect(settingDesc(modal, "Connection")).toContain("✓ Connected");

		const endpoint = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>("input")).find(
			(input) => input.value === "https://api.openai.com/v1",
		)!;
		endpoint.value = "https://proxy.example/v1";
		endpoint.dispatchEvent(new Event("input"));

		expect(settingDesc(modal, "Auto-sync models")).toContain("Not synced yet.");
		expect(settingDesc(modal, "Connection")).not.toContain("✓ Connected");
		expect(providers[0].lastModelSync).toBeUndefined();

		// Cancel restores the saved configuration together with its status.
		click(modal, "Cancel");
		expect(providers[0].lastModelSync?.at).toBeLessThan(Date.now());
	});

	it("updates the sync status line when the background sync lands or fails", async () => {
		let fail!: (error: Error) => void;
		discovery.discoverProviderModels.mockReturnValue(
			new Promise((_resolve, reject) => {
				fail = reject;
			}),
		);
		const modal = openEdit([provider([GPT4O], { autoSyncModels: true })]);
		expect(settingDesc(modal, "Auto-sync models")).toContain("Not synced yet.");

		fail(new Error("Request failed, status 503"));
		await flush();
		expect(settingDesc(modal, "Auto-sync models")).toContain(
			"Last sync failed just now: Request failed, status 503",
		);

		discovery.discoverProviderModels.mockResolvedValue([GPT4O, GPT6]);
		click(modal, "Sync now");
		await flush();
		await flush();
		expect(settingDesc(modal, "Auto-sync models")).toContain(
			"Last synced just now · 2 model(s).",
		);
	});
});
