import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { insertText, jsLiteral, POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// In the multi-select picker and the checkbox prompt, the first Esc clears a
// search and the next one cancels. Obsidian handles Esc in the modal's scope
// before the search box's own listener, so a run used to end on the first Esc.
const getContext = createQuickAddE2EHarness("multi-select-escape");

const SEARCH = ".qa-searchable-multi-select__search";

async function searchState() {
	return getContext().obsidian.dev.evalJson<{ open: boolean; query: string; rows: number }>(`(() => ({
		open: Boolean(document.querySelector(${jsLiteral(SEARCH)})),
		query: document.querySelector(${jsLiteral(SEARCH)})?.value ?? "",
		rows: document.querySelectorAll(".qa-searchable-multi-select__option").length,
	}))()`);
}

async function searchThenEscape() {
	const { obsidian } = getContext();
	await waitForElement(obsidian, SEARCH);
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`document.activeElement === document.querySelector(${jsLiteral(SEARCH)})`,
	), POLL_OPTS).toBe(true);
	await insertText(obsidian, "Gam");
	await expect.poll(searchState, POLL_OPTS).toEqual({ open: true, query: "Gam", rows: 1 });

	await pressKey(obsidian, "Escape");
	await obsidian.sleep(300);
	expect(await searchState()).toEqual({ open: true, query: "", rows: 3 });
}

it("clears the search on the first Esc and keeps the Capture run going", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const capture = new CaptureChoice("Escape multi capture");
	capture.captureTo = sandbox.path("Picks.md");
	capture.createFileIfItDoesntExist = { enabled: true, createWithTemplate: false, template: "" };
	capture.onePageInput = "never";
	capture.format = { enabled: true, format: "{{VALUE:Alpha,Beta,Gamma|multi}}" };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [capture];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson(`(() => {
		window.__qaEscapeRun = "running";
		app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(capture.name)})
			.then(() => { window.__qaEscapeRun = "done"; }, (error) => { window.__qaEscapeRun = String(error?.message ?? error); });
		return true;
	})()`);
	await searchThenEscape();

	await obsidian.dev.evalJson(`(() => {
		document.querySelector(".qa-searchable-multi-select__option input").click();
		document.querySelector(".qaMultiSuggester button.mod-cta").click();
		return true;
	})()`);
	await expect.poll(() => obsidian.dev.evalJson<string>("window.__qaEscapeRun"), POLL_OPTS).toBe("done");
	expect((await sandbox.read("Picks.md")).trim()).toBe("Alpha");
});

it.each([
	["multi-select picker", `app.plugins.plugins.quickadd.api.format("{{VALUE:Alpha,Beta,Gamma|multi}}")`],
	["checkbox prompt", `app.plugins.plugins.quickadd.api.checkboxPrompt(["Alpha", "Beta", "Gamma"])`],
])("cancels the %s on Esc once the search is empty", async (_name, open) => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`(() => {
		window.__qaEscapeResult = "pending";
		${open}.then(() => { window.__qaEscapeResult = "resolved"; }, (error) => { window.__qaEscapeResult = String(error?.message ?? error); });
		return true;
	})()`);
	await searchThenEscape();

	await pressKey(obsidian, "Escape");
	await expect.poll(() => obsidian.dev.evalJson<string>("window.__qaEscapeResult"), POLL_OPTS)
		.toBe("Input cancelled by user");
	expect((await searchState()).open).toBe(false);
});
