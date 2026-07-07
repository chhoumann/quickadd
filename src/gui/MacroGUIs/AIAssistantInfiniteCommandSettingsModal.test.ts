import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import type { IInfiniteAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";

// The system-prompt field wires up a format-syntax suggester and a live
// formatter; neither is relevant to this regression, so stub them out to keep
// the modal constructable in jsdom.
vi.mock("src/quickAddInstance", () => ({
	getQuickAddInstance: () => ({}),
}));
vi.mock("./../suggesters/formatSyntaxSuggester", () => ({
	FormatSyntaxSuggester: class {
		constructor() {
			// no-op: real suggester needs app.dom/keymap
		}
	},
}));
vi.mock("src/formatters/formatDisplayFormatter", () => ({
	FormatDisplayFormatter: class {
		async format(input: string): Promise<string> {
			return input;
		}
	},
}));

import { InfiniteAIAssistantCommandSettingsModal } from "./AIAssistantInfiniteCommandSettingsModal";

function makeSettings(model: string): IInfiniteAIAssistantCommand {
	return {
		id: "infinite-test",
		name: "Summarize",
		type: "AIAssistant",
		model,
		systemPrompt: "You are a helpful assistant.",
		outputVariableName: "output",
		modelParameters: {},
		resultJoiner: "\n",
		chunkSeparator: "\n",
		maxChunkTokens: 1000,
		mergeChunks: false,
	} as unknown as IInfiniteAIAssistantCommand;
}

describe("InfiniteAIAssistantCommandSettingsModal max-chunk-tokens", () => {
	beforeAll(() => {
		// The shared obsidian stub's Setting lacks addSlider; shim it locally so
		// the modal can render the Max Chunk Tokens slider (documented harness gap).
		const settingProto = Setting.prototype as unknown as {
			addSlider?: (cb: (slider: unknown) => void) => unknown;
		};
		settingProto.addSlider ??= function addSlider(
			this: unknown,
			cb: (slider: unknown) => void,
		) {
			const slider = {
				setLimits: () => slider,
				setValue: () => slider,
				setInstant: () => slider,
				setDynamicTooltip: () => slider,
				onChange: () => slider,
			};
			cb(slider);
			return this;
		};
	});

	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("renders the full modal when the model is the 'Ask me' sentinel instead of throwing/blanking", () => {
		const settings = makeSettings("Ask me");

		let modal: InfiniteAIAssistantCommandSettingsModal | undefined;
		expect(() => {
			modal = new InfiniteAIAssistantCommandSettingsModal(
				new App() as App,
				settings,
			);
		}).not.toThrow();

		// Both the slider (early in display()) and the System Prompt (last in
		// display()) must render — proving display() did not abort midway and
		// blank the modal.
		const text = modal!.contentEl.textContent ?? "";
		expect(text).toContain("Max Chunk Tokens");
		expect(text).toContain("System Prompt");
	});

	it("renders without throwing when the configured model no longer exists", () => {
		const settings = makeSettings("removed-model-9000");

		expect(() => {
			new InfiniteAIAssistantCommandSettingsModal(new App() as App, settings);
		}).not.toThrow();
	});

	it("surfaces a removed model as a disabled (missing) option instead of a blank dropdown", () => {
		const settings = makeSettings("removed-model-9000");

		const modal = new InfiniteAIAssistantCommandSettingsModal(
			new App() as App,
			settings,
		);

		const select = modal.contentEl.querySelector<HTMLSelectElement>("select");
		expect(select).not.toBeNull();

		const missing = Array.from(select!.options).find((option) =>
			option.textContent?.startsWith("(missing)"),
		);
		expect(missing).toBeDefined();
		expect(missing!.textContent).toBe("(missing) removed-model-9000");
		expect(missing!.disabled).toBe(true);
	});

	it("still renders for a known model", () => {
		const settings = makeSettings("gpt-4o");

		let modal: InfiniteAIAssistantCommandSettingsModal | undefined;
		expect(() => {
			modal = new InfiniteAIAssistantCommandSettingsModal(
				new App() as App,
				settings,
			);
		}).not.toThrow();
		expect(modal!.contentEl.textContent ?? "").toContain("Max Chunk Tokens");
	});
});
