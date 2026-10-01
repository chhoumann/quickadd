import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { jsLiteral, POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("multi-select-layout");

// #2128: without the custom-value row, the footer's top rule sat on the list's
// bottom border (0px apart; 8px with the custom row).
it.each([
	["without", "{{VALUE:Alpha,Beta,Gamma|multi}}"],
	["with", "{{VALUE:Alpha,Beta,Gamma|multi|custom}}"],
])("keeps the multi-select list off the next row %s a custom-value row", async (_name, format) => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`(() => {
		app.plugins.plugins.quickadd.api.format(${jsLiteral(format)}).catch(() => {});
		return true;
	})()`);
	try {
		await waitForElement(obsidian, ".qaMultiSuggester .qa-searchable-multi-select__list");
		const gap = await obsidian.dev.evalJson<number>(`(() => {
			const list = document.querySelector(".qaMultiSuggester .qa-searchable-multi-select__list").getBoundingClientRect();
			const next = document.querySelector(".qaMultiSuggester .qa-multi-list").nextElementSibling.getBoundingClientRect();
			return Math.round(next.top - list.bottom);
		})()`);
		expect(gap).toBe(8);
	} finally {
		await pressKey(obsidian, "Escape");
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".qaMultiSuggester"))',
		), POLL_OPTS).toBe(false);
	}
});
