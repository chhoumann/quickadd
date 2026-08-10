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
});
