import { afterEach, beforeEach, expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, clickWhenStill, closeOpenPrompts, insertText, jsLiteral, pressKey, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("request-inputs-header");

beforeEach(() => closeOpenPrompts(getContext().obsidian));
afterEach(async () => {
	await closeOpenPrompts(getContext().obsidian);
	await getContext().obsidian.dev.evalJson<boolean>("delete window.__qaRequestInputs; true");
});

const FORM = ".onePageInputModal";

async function openForm(options?: { title?: string; description?: string }) {
	const { obsidian } = getContext();
	const optionsArg = options ? `, ${jsLiteral(options)}` : "";
	await obsidian.dev.evalJson<boolean>(`(() => {
		window.__qaRequestInputs = { status: "pending" };
		void app.plugins.plugins.quickadd.api.requestInputs([{ id: "mood", label: "Mood", type: "text" }]${optionsArg}).then(
			(values) => { window.__qaRequestInputs = { status: "resolved", values }; },
			(error) => { window.__qaRequestInputs = { status: "rejected", name: error?.name }; },
		);
		return true;
	})()`);
	await waitForElement(obsidian, `${FORM} h2.qa-onepage-title`);
}

function header() {
	return getContext().obsidian.dev.evalJson<{ title: string | null; description: string | null }>(`(() => {
		const modal = [...document.querySelectorAll(${jsLiteral(FORM)})].at(-1);
		return {
			title: modal.querySelector("h2.qa-onepage-title")?.textContent ?? null,
			description: modal.querySelector("p.qa-onepage-description")?.textContent ?? null,
		};
	})()`);
}

it("shows a script's title and description, and keeps the title while peeking", async () => {
	const { obsidian } = getContext();
	await openForm({ title: "  Weekly review ", description: "Answer what applies.\nSkip the rest." });

	expect(await header()).toEqual({
		title: "Weekly review",
		description: "Answer what applies.\nSkip the rest.",
	});

	await clickWhenStill(obsidian, `${FORM} .qa-peek-button`);
	await expect.poll(() => obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".qa-peek-chip-title, .qa-peek-chip-subtitle"), (el) => el.textContent)',
	), POLL_OPTS).toContain("Weekly review");

	await clickWhenStill(obsidian, '.qa-peek-chip-actions button[aria-label="Go back to the prompt without inserting"]');
	await waitForElement(obsidian, `${FORM} input`);
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const input = document.querySelector(${jsLiteral(`${FORM} input`)});
		input.focus();
		return document.activeElement === input;
	})()`)).toBe(true);
	await insertText(obsidian, "calm");
	await pressKey(obsidian, "Enter", true);

	await expect.poll(() => obsidian.dev.evalJson("window.__qaRequestInputs"), POLL_OPTS).toEqual({
		status: "resolved",
		values: { mood: "calm" },
	});
});

it.each([
	["no options", undefined],
	["a blank title and description", { title: "   ", description: " \n " }],
])("keeps the default header for %s", async (_, options) => {
	await openForm(options);

	expect(await header()).toEqual({ title: "Provide inputs", description: null });
});
