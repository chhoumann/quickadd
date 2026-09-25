import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

const mocks = vi.hoisted(() => ({
	collectFieldValuesProcessed: vi.fn(),
}));

vi.mock("src/utils/FieldValueCollector", () => ({
	collectFieldValuesProcessed: mocks.collectFieldValuesProcessed,
}));

import { FieldValueInputSuggest } from "./FieldValueInputSuggest";

describe("FieldValueInputSuggest", () => {
	beforeEach(() => {
		mocks.collectFieldValuesProcessed.mockReset();
	});

	it("observes shared cache invalidation while the input remains open", async () => {
		mocks.collectFieldValuesProcessed
			.mockResolvedValueOnce(["ValueA"])
			.mockResolvedValueOnce(["ValueD"]);
		const input = document.createElement("input");
		document.body.appendChild(input);
		const app = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: vi.fn(), popScope: vi.fn() },
		} as unknown as App;
		const suggest = new FieldValueInputSuggest(app, input, "status");

		await expect(suggest.getSuggestions("")).resolves.toEqual(["ValueA"]);
		await expect(suggest.getSuggestions("")).resolves.toEqual(["ValueD"]);
		expect(mocks.collectFieldValuesProcessed).toHaveBeenCalledTimes(2);

		suggest.destroy();
		input.remove();
	});

	it("keeps the highlight ranges of the newest query when an older lookup resolves last", async () => {
		let resolveOld!: (values: string[]) => void;
		mocks.collectFieldValuesProcessed
			.mockReturnValueOnce(new Promise<string[]>((resolve) => { resolveOld = resolve; }))
			.mockResolvedValueOnce(["alpha", "beta"]);
		const input = document.createElement("input");
		document.body.appendChild(input);
		input.focus();
		const app = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: vi.fn(), popScope: vi.fn() },
		} as unknown as App;
		const suggest = new FieldValueInputSuggest(app, input, "status");

		input.value = "a";
		const old = suggest.onInputChanged();
		input.value = "b";
		await suggest.onInputChanged();
		resolveOld(["alpha", "beta"]);
		await old;

		const el = document.createElement("div");
		suggest.renderSuggestion("beta", el);
		expect(el.innerHTML).toBe('<mark class="qa-highlight">b</mark>eta');

		suggest.destroy();
		input.remove();
	});
});
