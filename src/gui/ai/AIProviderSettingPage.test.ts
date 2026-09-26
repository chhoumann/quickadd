import { App, Notice } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, Model } from "src/ai/Provider";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";

const mocks = vi.hoisted(() => ({
	discover: vi.fn(),
	input: vi.fn(),
	confirm: vi.fn(),
}));
vi.mock("src/ai/modelDiscoveryService", () => ({ discoverProviderModels: mocks.discover }));
vi.mock("../GenericInputPrompt/GenericInputPrompt", () => ({ default: { Prompt: mocks.input } }));
vi.mock("../GenericYesNoPrompt/GenericYesNoPrompt", () => ({ default: { Prompt: mocks.confirm } }));

import { AIProviderSettingPage } from "./AIProviderSettingPage";

const OLD: Model = { name: "old", maxTokens: 10, releaseDate: "2020-01-01" };
const NEW: Model = { name: "new", maxTokens: 20, releaseDate: "2025-01-01" };
const RETIRED: Model = { name: "retired", maxTokens: 30, releaseDate: "2026-01-01", deprecated: true };

function provider(id = "target", models: Model[] = [OLD]): AIProvider {
	return { id, name: id, endpoint: `https://${id}.example/v1`, apiKey: "", modelSource: "modelsDev", autoSyncModels: false, models };
}

function install(...providers: AIProvider[]): void {
	settingsStore.setState((state) => ({ ai: { ...state.ai, providers } }));
}

function open(id = "target"): AIProviderSettingPage {
	const page = new AIProviderSettingPage(new App(), id);
	page.display();
	return page;
}

function button(page: AIProviderSettingPage, text: string): HTMLElement {
	const found = Array.from(page.containerEl.querySelectorAll<HTMLElement>("button, [aria-label]"))
		.find((el) => el.textContent === text || el.getAttribute("aria-label") === text);
	if (!found) throw new Error(`Missing button ${text}`);
	return found;
}

function modelNames(page: AIProviderSettingPage): string[] {
	const list = page.containerEl.querySelector(".qa-ai-models-group")?.lastElementChild;
	return Array.from(list?.children ?? [])
		.map((row) => row.firstElementChild?.firstElementChild?.childNodes[0]?.textContent ?? "")
		.filter((name) => ["old", "new", "retired", "local", "fresh"].includes(name));
}

function setting(page: AIProviderSettingPage, name: string): HTMLElement {
	const nameEl = Array.from(page.containerEl.querySelectorAll("div")).find((el) =>
		el.childNodes.length === 1 && el.textContent === name,
	);
	if (!nameEl?.parentElement?.parentElement) throw new Error(`Missing setting ${name}`);
	return nameEl.parentElement.parentElement;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const notices = () => (Notice as unknown as { instances: Array<{ message: string }> }).instances.map((n) => n.message);

describe("AIProviderSettingPage", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
		settingsStore.setState({ disableOnlineFeatures: false });
		mocks.discover.mockReset();
		mocks.input.mockReset();
		mocks.confirm.mockReset().mockResolvedValue(true);
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;
	});

	afterEach(() => { document.body.innerHTML = ""; });

	it("sorts newest-first with retired last without changing storage, and filters", () => {
		install(provider("target", [OLD, RETIRED, NEW]));
		const page = open();
		expect(modelNames(page)).toEqual(["new", "old", "retired"]);
		expect(settingsStore.getState().ai.providers[0].models).toEqual([OLD, RETIRED, NEW]);

		const search = page.containerEl.querySelector<HTMLInputElement>('input[type="search"]')!;
		search.value = "OLD";
		search.dispatchEvent(new Event("input"));
		expect(modelNames(page)).toEqual(["old"]);
	});

	it("deletes the clicked display row by name after model objects are replaced", async () => {
		install(provider("target", [OLD, NEW]));
		const page = open();
		let resolve!: (answer: boolean) => void;
		mocks.confirm.mockReturnValueOnce(new Promise<boolean>((done) => { resolve = done; }));
		const rows = Array.from(page.containerEl.querySelectorAll(".qa-ai-models-group > :last-child > div"));
		(rows[0].querySelector('[aria-label="Delete model"]') as HTMLElement).click();
		install({ ...settingsStore.getState().ai.providers[0], models: [OLD, NEW].map((m) => ({ ...m })) });
		resolve(true);
		await flush();
		expect(settingsStore.getState().ai.providers[0].models.map((m) => m.name)).toEqual(["old"]);
	});

	it("removes only retired names captured before confirmation", async () => {
		install(provider("target", [OLD, RETIRED, NEW]));
		const page = open();
		let resolve!: (answer: boolean) => void;
		mocks.confirm.mockReturnValueOnce(new Promise<boolean>((done) => { resolve = done; }));
		button(page, "Remove retired").click();
		install({ ...settingsStore.getState().ai.providers[0], models: [
			{ ...OLD, deprecated: true }, RETIRED, NEW,
		] });
		resolve(true);
		await flush();
		expect(settingsStore.getState().ai.providers[0].models.map((m) => m.name)).toEqual(["old", "new"]);
	});

	it("tests the provider API and renders success and unkeyed failure lines", async () => {
		install(provider());
		mocks.discover.mockResolvedValueOnce([OLD, NEW]);
		const page = open();
		button(page, "Test connection").click();
		await vi.waitFor(() => expect(setting(page, "Connection").textContent).toContain("✓ Connected. The provider lists 2 models."));
		expect(mocks.discover).toHaveBeenCalledWith(expect.objectContaining({ modelSource: "providerApi" }), "");

		mocks.discover.mockRejectedValueOnce(new Error("401"));
		button(page, "Test connection").click();
		await vi.waitFor(() => expect(setting(page, "Connection").textContent).toContain("✗ 401 (No API key is linked.)"));
	});

	it("endpoint edits clear sync and connection status and target the correct provider", async () => {
		install(provider("other"), { ...provider(), lastModelSync: { at: Date.now() } });
		mocks.discover.mockResolvedValue([OLD]);
		const page = open();
		button(page, "Test connection").click();
		await vi.waitFor(() => expect(setting(page, "Connection").textContent).toContain("✓"));
		const endpoint = setting(page, "Endpoint").querySelector("input")!;
		endpoint.value = "https://changed.example";
		endpoint.dispatchEvent(new Event("input"));
		expect(settingsStore.getState().ai.providers.map((p) => [p.id, p.endpoint])).toEqual([
			["other", "https://other.example/v1"], ["target", "https://changed.example"],
		]);
		expect(settingsStore.getState().ai.providers[1].lastModelSync).toBeUndefined();
		expect(setting(page, "Connection").textContent).not.toContain("✓");
	});

	it("name edits update only the addressed provider", () => {
		install(provider("other"), provider());
		const page = open();
		const input = setting(page, "Name").querySelector("input")!;
		input.value = "Renamed";
		input.dispatchEvent(new Event("input"));
		expect(settingsStore.getState().ai.providers.map((p) => p.name)).toEqual(["other", "Renamed"]);
	});

	it("re-renders list and status when on-open sync lands, and records failures", async () => {
		install({ ...provider(), autoSyncModels: true });
		mocks.discover.mockResolvedValueOnce([OLD, { name: "fresh", maxTokens: 99 }]);
		const page = open();
		await vi.waitFor(() => expect(modelNames(page)).toEqual(["old", "fresh"]));
		expect(setting(page, "Auto-sync models").textContent).toContain("Last synced just now");

		mocks.discover.mockRejectedValueOnce(new Error("service unavailable"));
		button(page, "Sync now").click();
		await vi.waitFor(() => expect(setting(page, "Auto-sync models").textContent).toContain("service unavailable"));
	});

	it("Sync now excludes a concurrent local model from its added count and reports up-to-date", async () => {
		install(provider());
		let resolve!: (models: Model[]) => void;
		mocks.discover.mockReturnValueOnce(new Promise<Model[]>((done) => { resolve = done; }));
		const page = open();
		button(page, "Sync now").click();
		install({ ...settingsStore.getState().ai.providers[0], models: [OLD, { name: "local", maxTokens: 5 }] });
		resolve([OLD, NEW]);
		await vi.waitFor(() => expect(notices()).toContain("Synced from the models.dev directory: 1 new, 0 updated."));

		mocks.discover.mockResolvedValueOnce([OLD, NEW]);
		button(page, "Sync now").click();
		await vi.waitFor(() => expect(notices().at(-1)).toContain("already up to date"));
	});

	it.each([
		["blank name", ["   ", "10"]],
		["non-numeric tokens", ["model", "wat"]],
		["trailing junk", ["model", "10abc"]],
		["duplicate", ["old", "10"]],
	] as const)("rejects invalid Add model input: %s", async (_label, answers) => {
		install(provider());
		mocks.input.mockResolvedValueOnce(answers[0]).mockResolvedValueOnce(answers[1]);
		const page = open();
		button(page, "Add model").click();
		await vi.waitFor(() => expect(mocks.input).toHaveBeenCalledTimes(2));
		await flush();
		expect(settingsStore.getState().ai.providers[0].models).toEqual([OLD]);
	});

	it("treats Add model cancellation as a no-op and appends valid input", async () => {
		install(provider());
		mocks.input.mockRejectedValueOnce(new Error("cancel"));
		const page = open();
		button(page, "Add model").click();
		await flush();
		expect(settingsStore.getState().ai.providers[0].models).toEqual([OLD]);

		mocks.input.mockResolvedValueOnce(" valid ").mockResolvedValueOnce("128000");
		button(page, "Add model").click();
		await vi.waitFor(() => expect(settingsStore.getState().ai.providers[0].models.at(-1)).toEqual({ name: "valid", maxTokens: 128000 }));
	});

	it("hide unsubscribes and removed providers render a terminal message", () => {
		install(provider());
		const page = open();
		page.hide();
		page.containerEl.remove();
		expect(() => install({ ...provider(), models: [NEW] })).not.toThrow();

		install();
		const removed = open();
		expect(removed.containerEl.textContent).toBe("This provider no longer exists.");
	});

	function openWithSettingModal(id = "target") {
		const setting = { closePage: vi.fn(), updatePageTitle: vi.fn() };
		const app = Object.assign(new App(), { setting });
		const page = new AIProviderSettingPage(app as unknown as App, id);
		page.display();
		return { page, setting };
	}

	// Page entries get no trash button from Obsidian, and Delete/Backspace needs
	// a keyboard, so the page itself must offer deletion (phones).
	it("deletes the provider from its own page after confirmation, then goes back", async () => {
		install(provider("other"), provider());
		const { page, setting } = openWithSettingModal();

		mocks.confirm.mockResolvedValueOnce(false);
		button(page, "Delete").click();
		await flush();
		expect(settingsStore.getState().ai.providers.map((p) => p.id)).toEqual(["other", "target"]);
		expect(setting.closePage).not.toHaveBeenCalled();

		mocks.confirm.mockResolvedValueOnce(true);
		button(page, "Delete").click();
		await flush();
		expect(settingsStore.getState().ai.providers.map((p) => p.id)).toEqual(["other"]);
		expect(setting.closePage).toHaveBeenCalledTimes(1);
	});

	it("keeps both titles in step with a rename", () => {
		install(provider());
		const { page, setting: modal } = openWithSettingModal();
		const titleEl = page.titlebarEl.createDiv({ cls: "setting-page-title", text: "target" });
		const input = setting(page, "Name").querySelector("input")!;

		input.value = "  Work  ";
		input.dispatchEvent(new Event("input"));
		expect([page.title, titleEl.textContent]).toEqual(["Work", "Work"]);
		expect(modal.updatePageTitle).toHaveBeenCalled();

		input.value = " ";
		input.dispatchEvent(new Event("input"));
		expect(page.title).toBe("Untitled provider");
	});

	it("colors connection and sync results by outcome", async () => {
		install(provider());
		const page = open();
		const line = () => setting(page, "Connection").querySelector(".qa-ai-status-line")!;

		mocks.discover.mockResolvedValueOnce([OLD]);
		button(page, "Test connection").click();
		await vi.waitFor(() => expect(line().classList.contains("mod-success")).toBe(true));
		expect(line().classList.contains("mod-error")).toBe(false);

		mocks.discover.mockRejectedValueOnce(new Error("401"));
		button(page, "Test connection").click();
		await vi.waitFor(() => expect(line().classList.contains("mod-error")).toBe(true));
		expect(line().classList.contains("mod-success")).toBe(false);

		mocks.discover.mockRejectedValueOnce(new Error("503"));
		button(page, "Sync now").click();
		await vi.waitFor(() =>
			expect(setting(page, "Auto-sync models").querySelector(".qa-ai-status-line")!.classList.contains("mod-error")).toBe(true),
		);
	});

	it("does not auto-sync while online features are disabled", async () => {
		settingsStore.setState({ disableOnlineFeatures: true });
		install({ ...provider(), autoSyncModels: true });
		open();
		await flush();
		expect(mocks.discover).not.toHaveBeenCalled();
	});
});
