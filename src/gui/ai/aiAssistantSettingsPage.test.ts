import { App, Setting } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "src/ai/Provider";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	picked: null as AIProvider | null,
}));
vi.mock("../GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	default: { Prompt: mocks.confirm },
}));
vi.mock("../ProviderPickerModal", () => ({
	ProviderPickerModal: class {
		waitForClose: Promise<void>;
		constructor(_app: unknown, providers: AIProvider[]) {
			if (mocks.picked) providers.push(mocks.picked);
			this.waitForClose = Promise.resolve();
		}
	},
}));

import { aiPageSignature, createAIAssistantPage } from "./aiAssistantSettingsPage";

function provider(id: string, name: string, models: AIProvider["models"] = []): AIProvider {
	return { id, name, endpoint: `https://${id}.example/v1`, apiKey: "", modelSource: "providerApi", models };
}

function providerList() {
	const page = createAIAssistantPage(new App());
	return page.items![0] as unknown as {
		items: Array<{ type: string; name: string; desc: string; status: unknown; displayValue: unknown }>;
		onDelete: (index: number) => void;
		addItem: { action: () => void };
	};
}

describe("AI Assistant settings page", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
		mocks.confirm.mockReset();
		mocks.picked = null;
	});

	// Only user edits change the signature; a background sync (new models,
	// newly retired ones, sync status) must not rebuild and re-render the tab.
	it("signs entry-affecting changes but ignores model and sync metadata", () => {
		const base = provider("a", "Alpha", [{ name: "old", maxTokens: 1 }]);
		const signature = aiPageSignature([base]);
		for (const changed of [
			[base, provider("b", "Beta")],
			[],
			[{ ...base, name: "Renamed" }],
			[{ ...base, endpoint: "https://other.example" }],
		]) expect(aiPageSignature(changed as AIProvider[])).not.toBe(signature);

		expect(aiPageSignature([{ ...base, models: [{ ...base.models[0], deprecated: true }] }])).toBe(signature);
		expect(aiPageSignature([{ ...base, models: [{ name: "new", maxTokens: 999 }] }])).toBe(signature);
		expect(aiPageSignature([{ ...base, lastModelSync: { at: 123, error: "x" } }])).toBe(signature);
	});

	it("builds uniquely named provider pages whose retired count and warning read the store live", () => {
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [
			provider("a", "Same", [{ name: "retired", maxTokens: 1, deprecated: true }]),
			provider("b", "Same"),
		] } }));

		const items = providerList().items;
		expect(items.map((item) => item.type)).toEqual(["page", "page"]);
		expect(items.map((item) => item.name)).toEqual(["Same (a)", "Same (b)"]);
		const live = (value: unknown) => (typeof value === "function" ? value() : value);
		expect(items.map((item) => item.desc)).toEqual(["https://a.example/v1", "https://b.example/v1"]);
		expect(items.map((item) => live(item.displayValue))).toEqual(["1 retired", ""]);
		expect(items.map((item) => live(item.status))).toEqual(["warning", null]);

		// A sync retires a model on "b" after the definitions were built: the
		// same definitions show it on their next render, without a rebuild.
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [
			state.ai.providers[0],
			{ ...state.ai.providers[1], models: [
				{ name: "x", maxTokens: 1, deprecated: true },
				{ name: "y", maxTokens: 1, deprecated: true },
			] },
		] } }));
		expect(items.map((item) => live(item.displayValue))).toEqual(["1 retired", "2 retired"]);
		expect(live(items[1].status)).toBe("warning");
	});

	it("deletes the captured index by id only after confirmation", async () => {
		const alpha = provider("a", "Alpha");
		const beta = provider("b", "Beta");
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [alpha, beta] } }));
		const list = providerList();
		mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

		list.onDelete(1);
		await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
		expect(settingsStore.getState().ai.providers.map((p) => p.id)).toEqual(["a", "b"]);
		list.onDelete(0);
		await vi.waitFor(() => expect(settingsStore.getState().ai.providers.map((p) => p.id)).toEqual(["b"]));
	});

	it("appends exactly the provider returned by the picker", async () => {
		const original = provider("a", "Alpha");
		const added = provider("b", "Beta");
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [original] } }));
		mocks.picked = added;

		providerList().addItem.action();
		await vi.waitFor(() => expect(settingsStore.getState().ai.providers).toHaveLength(2));
		expect(settingsStore.getState().ai.providers).toEqual([original, added]);
	});

	// A provider page's auto-sync often lands after the user returned here.
	it("refreshes the default model options when providers change, until cleaned up", () => {
		settingsStore.setState((state) => ({ ai: { ...state.ai, defaultModel: "Ask me", providers: [
			provider("a", "Alpha", [{ name: "one", maxTokens: 1 }]),
		] } }));
		const defaults = createAIAssistantPage(new App()).items![1] as unknown as {
			items: Array<{ name: string; render?: (setting: Setting) => (() => void) | void }>;
		};
		const row = defaults.items.find((item) => item.name === "Default model")!;
		const setting = new Setting(document.createElement("div"));
		const cleanup = row.render!(setting) as () => void;
		const options = () => Array.from(setting.controlEl.querySelectorAll("option")).map((o) => o.textContent);
		expect(options()).toEqual(["Ask me", "one"]);

		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [
			{ ...state.ai.providers[0], models: [{ name: "one", maxTokens: 1 }, { name: "two", maxTokens: 1 }] },
		] } }));
		expect(options()).toEqual(["Ask me", "one", "two"]);

		cleanup();
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [] } }));
		expect(options()).toEqual(["Ask me", "one", "two"]);
	});

	it("follows the online gate and uses the nested AI control keys", () => {
		settingsStore.setState({ disableOnlineFeatures: false });
		const page = createAIAssistantPage(new App());
		const visible = page.visible as () => boolean;
		expect(visible()).toBe(true);
		settingsStore.setState({ disableOnlineFeatures: true });
		expect(visible()).toBe(false);
		const defaults = page.items![1] as unknown as { items: Array<{ name: string; control?: { key: string } }> };
		expect(defaults.items.filter((item) => item.control).map((item) => [item.name, item.control?.key])).toEqual([
			["Prompt template folder", "ai.promptTemplatesFolderPath"],
			["Show assistant", "ai.showAssistant"],
			["Confirm AI tool calls", "ai.confirmToolCalls"],
		]);
	});
});
