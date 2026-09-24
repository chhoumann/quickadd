import { afterEach, describe, expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";

// #1794: a one-page `suggester` field ranks its matches by relevance with
// Obsidian's own scorer, so the option the user is typing the start of comes
// first instead of whatever contains the letters earlier in the list.
const getContext = createQuickAddE2EHarness("one-page-suggester-ranking");

const FORM = ".onePageInputModal";
const COMPANY_INPUT = `${FORM} input[aria-labelledby="qa-onepage-label-company"]`;
const TAGS_INPUT = `${FORM} input[aria-labelledby="qa-onepage-label-tags"]`;

const COMPANIES = ["Aqua Carpatica", "Bank Stołeczny", "C", "Creative Labs", "Kawa Górska"];
const TAGS = ["client", "conference", "prospect", "vip"];

async function openForm() {
	const { obsidian } = getContext();
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		window.__qaRankingForm = app.plugins.plugins.quickadd.api.requestInputs(${JSON.stringify([
			{ id: "company", label: "Company", type: "suggester", options: COMPANIES },
			{ id: "tags", label: "Tags", type: "suggester", options: TAGS, suggesterConfig: { multiSelect: true } },
		])});
		window.__qaRankingForm.catch(() => {});
		return true;
	})()`)).toBe(true);
	await waitForElement(obsidian, COMPANY_INPUT);
}

async function suggestions(): Promise<string[]> {
	const { obsidian } = getContext();
	return obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".suggestion-container .suggestion-item")).map((item) => item.textContent)',
	);
}

async function expectSuggestions(expected: string[]) {
	await expect.poll(suggestions, POLL_OPTS).toEqual(expected);
}

async function inputValue(selector: string): Promise<string> {
	const { obsidian } = getContext();
	return obsidian.dev.evalJson<string>(
		`document.querySelector(${JSON.stringify(selector)}).value`,
	);
}

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson<boolean>(`(() => {
		for (const modal of document.querySelectorAll(${JSON.stringify(FORM)})) {
			Array.from(modal.querySelectorAll("button"))
				.find((button) => button.textContent.trim() === "Cancel")
				?.click();
		}
		return true;
	})()`);
	await expect.poll(
		() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${JSON.stringify(FORM)}))`),
		POLL_OPTS,
	).toBe(false);
});

describe("one-page suggester ranking", () => {
	it("ranks an exact match, then prefixes, then word starts, then the rest", async () => {
		await openForm();

		await typeInto(getContext().obsidian, COMPANY_INPUT, "c");
		await expectSuggestions(["C", "Creative Labs", "Aqua Carpatica", "Bank Stołeczny"]);

		// "cr" is a prefix of Creative Labs and a gapped match in "Carpatica".
		await typeInto(getContext().obsidian, COMPANY_INPUT, "cr");
		await expectSuggestions(["Creative Labs", "Aqua Carpatica"]);

		await pressKey(getContext().obsidian, "Enter");
		await expect.poll(() => inputValue(COMPANY_INPUT), POLL_OPTS).toBe("Creative Labs");
	});

	it("highlights the matched characters", async () => {
		await openForm();

		await typeInto(getContext().obsidian, COMPANY_INPUT, "carp");
		await expectSuggestions(["Aqua Carpatica"]);
		expect(await getContext().obsidian.dev.evalJson<string>(
			'document.querySelector(".suggestion-container .suggestion-item").innerHTML',
		)).toBe('Aqua <mark class="qa-highlight">Carp</mark>atica');
	});

	it("ranks the term after the last comma in a multi-select", async () => {
		await openForm();

		await typeInto(getContext().obsidian, TAGS_INPUT, "c");
		await expectSuggestions(["client", "conference", "prospect"]);
		await pressKey(getContext().obsidian, "Enter");
		await expect.poll(() => inputValue(TAGS_INPUT), POLL_OPTS).toBe("client, ");

		await typeInto(getContext().obsidian, TAGS_INPUT, "client, p");
		await expectSuggestions(["prospect", "vip"]);
	});
});
