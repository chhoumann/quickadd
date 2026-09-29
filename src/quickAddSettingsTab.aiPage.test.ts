import { App, Notice, PluginSettingTab } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "./ai/Provider";
import type QuickAdd from "./main";
import { DEFAULT_SETTINGS } from "./settings";
import { settingsStore } from "./settingsStore";
import { deepClone } from "./utils/deepClone";

import { QuickAddSettingsTab } from "./quickAddSettingsTab";

function provider(id: string | undefined, name: string): AIProvider {
	return { id, name, endpoint: `https://${name}.example`, apiKey: "", modelSource: "providerApi", models: [] };
}

let cleanups: Array<() => void>;
function makeTab(app = new App()): QuickAddSettingsTab {
	const plugin = {
		app,
		register: vi.fn((cleanup: () => void) => cleanups.push(cleanup)),
	} as unknown as QuickAdd;
	return new QuickAddSettingsTab(app, plugin);
}

describe("QuickAddSettingsTab AI page bridge", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
		cleanups = [];
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;
	});

	afterEach(() => cleanups.forEach((cleanup) => cleanup()));

	it("reads and writes ai.* fields without clobbering siblings", () => {
		const tab = makeTab();
		const before = settingsStore.getState().ai.confirmToolCalls;
		tab.setControlValue("ai.showAssistant", false);
		expect(tab.getControlValue("ai.showAssistant")).toBe(false);
		expect(settingsStore.getState().ai.confirmToolCalls).toBe(before);
	});

	it("updates once per page signature change, not for unrelated writes", () => {
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [provider("a", "Alpha")] } }));
		const update = vi.spyOn(PluginSettingTab.prototype, "update");
		makeTab();
		settingsStore.setState({ choices: [] });
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [{
			...state.ai.providers[0], models: [{ name: "m", maxTokens: 123 }],
		}] } }));
		expect(update).not.toHaveBeenCalled();

		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [{ ...state.ai.providers[0], name: "Renamed" }] } }));
		expect(update).toHaveBeenCalledTimes(1);
		update.mockRestore();
	});

	it("backfills missing provider ids without changing existing ids", () => {
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [
			provider(undefined, "My Provider"), provider("fixed", "My Provider"),
		] } }));
		makeTab();
		const ids = settingsStore.getState().ai.providers.map((p) => p.id);
		expect(ids[1]).toBe("fixed");
		expect(ids[0]).toBeTruthy();
		expect(new Set(ids).size).toBe(2);
	});

	// The tab is constructed (and its definitions built) before migrations run;
	// legacy data can lack ai.providers until addDefaultAIProviders creates it.
	it("survives pre-migration settings without ai.providers, and writes nothing", () => {
		settingsStore.setState({ ai: { OpenAIApiKey: "legacy" } as never });
		const before = settingsStore.getState();
		let tab!: QuickAddSettingsTab;
		expect(() => {
			tab = makeTab();
			tab.getSettingDefinitions();
		}).not.toThrow();
		expect(settingsStore.getState()).toBe(before);
		expect(settingsStore.getState().ai.providers).toBeUndefined();
	});

	it("repairs two providers claiming the same id, keeping it on the first", () => {
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [
			provider("dup", "First"), provider("dup", "Second"),
		] } }));
		makeTab();
		const ids = settingsStore.getState().ai.providers.map((p) => p.id);
		expect(ids[0]).toBe("dup");
		expect(ids[1]).not.toBe("dup");
		expect(ids[1]).toBeTruthy();
	});

	it("leaves the store alone when every provider already has a unique id", () => {
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [provider("a", "A")] } }));
		const before = settingsStore.getState();
		makeTab();
		expect(settingsStore.getState()).toBe(before);
	});

	it("navigates to the AI Assistant page through Obsidian's internal API", () => {
		const app = new App() as App & { setting: { navigateToSearchResult: ReturnType<typeof vi.fn> } };
		app.setting = { navigateToSearchResult: vi.fn() };
		const tab = makeTab(app);
		tab.openAIAssistantPage();
		expect(app.setting.navigateToSearchResult).toHaveBeenCalledWith({ tab, pagePath: ["AI Assistant"] }, null);
	});

	it("the command opens the settings window on QuickAdd, then the AI Assistant page", () => {
		settingsStore.setState({ disableOnlineFeatures: false });
		const calls: string[] = [];
		const app = Object.assign(new App(), {
			setting: {
				open: vi.fn(() => calls.push("open")),
				openTabById: vi.fn((id: string) => calls.push(`tab:${id}`)),
				navigateToSearchResult: vi.fn((target: { pagePath: string[] }) =>
					calls.push(`page:${target.pagePath.join(">")}`),
				),
			},
		});
		const plugin = {
			app,
			manifest: { id: "quickadd" },
			register: vi.fn((cleanup: () => void) => cleanups.push(cleanup)),
		} as unknown as QuickAdd;
		new QuickAddSettingsTab(app as unknown as App, plugin).openAIAssistantPageFromCommand();
		expect(calls).toEqual(["open", "tab:quickadd", "page:AI Assistant"]);
	});

	it("the command explains itself instead of opening a hidden page while AI is off", () => {
		settingsStore.setState({ disableOnlineFeatures: true });
		const navigate = vi.fn();
		const app = Object.assign(new App(), {
			setting: { open: vi.fn(), openTabById: vi.fn(), navigateToSearchResult: navigate },
		});
		makeTab(app as unknown as App).openAIAssistantPageFromCommand();
		expect(navigate).not.toHaveBeenCalled();
		expect((Notice as unknown as { instances: Array<{ message: string }> }).instances.at(-1)?.message)
			.toContain("Disable AI & online features");
	});

	it("falls back to a Notice when internal navigation is unavailable", () => {
		makeTab().openAIAssistantPage();
		expect((Notice as unknown as { instances: Array<{ message: string }> }).instances.at(-1)?.message)
			.toContain("Open the AI Assistant page");
	});

	it("places the AI Assistant page in the AI & online group", () => {
		const groups = makeTab().getSettingDefinitions() as unknown as Array<{
			heading: string;
			items: Array<{ type?: string; name?: string }>;
		}>;
		const group = groups.find((candidate) => candidate.heading === "AI & online");
		expect(group?.items.some((item) => item.type === "page" && item.name === "AI Assistant")).toBe(true);
	});
});
