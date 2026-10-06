import { afterEach, beforeEach, expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import {
	addStep,
	clickWhenStill,
	insertText,
	jsLiteral,
	leaveSettingsPage,
	pickMenuItem,
	POLL_OPTS,
	pressKey,
	typeInto,
	waitForElement,
} from "./uiHelpers";

// "Run a sequence of steps" opens the sequence builder, which speaks steps as
// the compact builders do: what the sequence does at the top, a numbered row
// per step saying what it does, and one Add a step menu.
const getContext = createQuickAddE2EHarness("v3-sequence-builder");

const INBOX = "Inbox.md";
// The note a run starts from, which a Link it step links into; removed after.
const DASHBOARD = "Dashboard.md";

const inboxExists = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson<boolean>(`app.vault.getAbstractFileByPath(${jsLiteral(INBOX)}) !== null`);

beforeEach(async () => {
	const { obsidian } = getContext();
	// At the vault's root, so the step reads "Inbox"; removed after.
	paletteWasOff = false;
	expect(await inboxExists(obsidian)).toBe(false);
	await obsidian.dev.evalJsonAsync(`app.vault.create(${jsLiteral(INBOX)}, "# Inbox\\n").then(() => true)`);
});

let paletteWasOff = false;

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJsonAsync(`(async () => {
		app.setting.close();
		if (${paletteWasOff}) app.internalPlugins.getPluginById("command-palette").disable();
		app.workspace.getLeaf(false).setViewState({ type: "empty" });
		for (const path of [${jsLiteral(INBOX)}, ${jsLiteral(DASHBOARD)}]) {
			const file = app.vault.getAbstractFileByPath(path);
			if (file) await app.vault.delete(file);
		}
		return true;
	})()`);
});

const lede = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson<string>('document.querySelector(".macroBuilder .qaChoiceSummaryText").textContent');

/** Each step row: its name, and what it says under it (a wait's number is an input). */
const rows = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson<string[][]>(`[...document.querySelectorAll(".macroBuilder .quickAddCommandListItem")]
		.map((row) => [...row.querySelectorAll(".quickAddCommandLabel, .quickAddCommandDetail")]
			.map((el) => [...el.childNodes].map((node) => node.nodeName === "INPUT" ? node.value : node.textContent).join("").trim()))`);

const pageTitles = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson<string[]>("app.setting.pageStack.map((entry) => entry.page.title)");

it("builds a sequence from the Add a step menu, reorders it with the keyboard, and runs it", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.data<{ choices: IChoice[]; templateFolderPaths: string[] }>().patch(withStoredChoices((data) => {
		data.choices = [];
		data.templateFolderPaths = [];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await pickMenuItem(obsidian, ".qaFirstRunScratch .qaNewChoiceBtn", "Run a sequence of steps");
	await waitForElement(obsidian, ".macroBuilder .qaChoiceSummary");
	expect(await lede(obsidian)).toBe("No steps yet");
	expect(await rows(obsidian)).toEqual([]);

	// Add to a note opens its compact builder over the sequence.
	await addStep(obsidian, "Add to a note");
	await expect.poll(() => pageTitles(obsidian), POLL_OPTS).toEqual(["Sequence", "Add to note"]);
	const where = await obsidian.dev.evalJson<string>(`(() => {
		const label = [...document.querySelectorAll(".qa-builder-page label.setting-item-name")]
			.find((el) => el.getClientRects().length > 0 && el.textContent.trim() === "Where");
		return "#" + CSS.escape(label.htmlFor);
	})()`);
	await typeInto(obsidian, where, INBOX);
	await obsidian.dev.evalJson("document.activeElement.blur(), true");
	await leaveSettingsPage(obsidian);

	await expect.poll(() => rows(obsidian), POLL_OPTS).toEqual([["Add to note", "Adds a line at the bottom of Inbox"]]);
	expect(await lede(obsidian)).toBe("Adds a line at the bottom of Inbox");

	await addStep(obsidian, "Wait");
	await expect.poll(() => rows(obsidian), POLL_OPTS).toEqual([
		["Add to note", "Adds a line at the bottom of Inbox"],
		["Wait", "Waits 100 ms"],
	]);
	expect(await lede(obsidian)).toBe("Adds a line at the bottom of Inbox, waits 100 ms");

	// The wait first, from its row's handle with the keyboard.
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const handle = document.querySelector('.macroBuilder [aria-label="Reorder Wait"]');
		handle.focus();
		return document.activeElement === handle;
	})()`)).toBe(true);
	await pressKey(obsidian, "ArrowUp");
	await expect.poll(() => rows(obsidian), POLL_OPTS).toEqual([
		["Wait", "Waits 100 ms"],
		["Add to note", "Adds a line at the bottom of Inbox"],
	]);
	expect(await lede(obsidian)).toBe("Waits 100 ms, adds a line at the bottom of Inbox");

	await leaveSettingsPage(obsidian);
	await obsidian.dev.evalJson("app.setting.close(), true");

	// From the command palette, which the test vault keeps off: QuickAdd's
	// launcher, then the sequence.
	paletteWasOff = await obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		const palette = app.internalPlugins.getPluginById("command-palette");
		const off = !palette.enabled;
		if (off) await palette.enable();
		return off;
	})()`);
	await obsidian.dev.evalJson('app.commands.executeCommandById("command-palette:open"), true');
	await waitForElement(obsidian, ".prompt .prompt-input");
	await insertText(obsidian, "QuickAdd: Run");
	// The palette shows the plugin's name and the command's in their own spans.
	await expect.poll(() => obsidian.dev.evalJson<string | null>(
		'document.querySelector(".prompt .suggestion-item.is-selected")?.textContent.trim() ?? null',
	), POLL_OPTS).toBe("QuickAddRun");
	await pressKey(obsidian, "Enter");
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(".prompt .suggestion-item.is-selected")?.textContent.includes("Sequence"))',
	), POLL_OPTS).toBe(true);
	await pressKey(obsidian, "Enter");
	await waitForElement(obsidian, ".qaInputPrompt input");
	await insertText(obsidian, "from the palette");
	await pressKey(obsidian, "Enter");

	await expect.poll(() => obsidian.dev.evalJsonAsync<string>(
		`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(INBOX)}))`,
	), POLL_OPTS).toBe("# Inbox\nfrom the palette");
});

/** Open a new sequence's page, with a first step that adds a line to Inbox. */
async function newSequenceAddingToInbox(obsidian: ObsidianClient) {
	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await pickMenuItem(obsidian, ".qaFirstRunScratch .qaNewChoiceBtn", "Run a sequence of steps");
	await waitForElement(obsidian, ".macroBuilder .qaChoiceSummary");
	await addStep(obsidian, "Add to a note");
	await expect.poll(() => pageTitles(obsidian), POLL_OPTS).toEqual(["Sequence", "Add to note"]);
	const where = await obsidian.dev.evalJson<string>(`(() => {
		const label = [...document.querySelectorAll(".qa-builder-page label.setting-item-name")]
			.find((el) => el.getClientRects().length > 0 && el.textContent.trim() === "Where");
		return "#" + CSS.escape(label.htmlFor);
	})()`);
	await typeInto(obsidian, where, INBOX);
	await obsidian.dev.evalJson("document.activeElement.blur(), true");
	await leaveSettingsPage(obsidian);
	await expect.poll(() => rows(obsidian), POLL_OPTS).toEqual([["Add to note", "Adds a line at the bottom of Inbox"]]);
}

it("adds Link it, which also copies the link once its settings say so, and links the note it wrote into the note the run started from", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.data<{ choices: IChoice[]; templateFolderPaths: string[] }>().patch(withStoredChoices((data) => {
		data.choices = [];
		data.templateFolderPaths = [];
	}));
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJsonAsync(`app.vault.create(${jsLiteral(DASHBOARD)}, "# Dashboard").then(() => true)`);

	await newSequenceAddingToInbox(obsidian);
	await addStep(obsidian, "Link it");
	await expect.poll(() => rows(obsidian), POLL_OPTS).toEqual([
		["Add to note", "Adds a line at the bottom of Inbox"],
		["Link it", "Links it here"],
	]);

	await clickWhenStill(obsidian, '.macroBuilder [aria-label="Configure Link it"]');
	await waitForElement(obsidian, ".qaStepSettingsModal");
	expect(await obsidian.dev.evalJson<string>('document.querySelector(".qaStepSettingsModal .qa-modal-title").textContent')).toBe("Link it");
	await clickWhenStill(obsidian, '.qaStepSettingsModal [aria-label="Copy to clipboard"]');
	await clickWhenStill(obsidian, ".qaStepSettingsModal button.mod-cta");
	await expect.poll(() => obsidian.dev.evalJson<boolean>('document.querySelector(".qaStepSettingsModal") === null'), POLL_OPTS).toBe(true);

	await expect.poll(() => rows(obsidian), POLL_OPTS).toEqual([
		["Add to note", "Adds a line at the bottom of Inbox"],
		["Link it", "Links it here and copies its link"],
	]);
	expect(await lede(obsidian)).toBe("Adds a line at the bottom of Inbox, links it here and copies its link");
	await leaveSettingsPage(obsidian);
	await obsidian.dev.evalJson("app.setting.close(), true");

	const id = await obsidian.dev.evalJson<string>(
		'app.plugins.plugins.quickadd.settings.choices.find((choice) => choice.name === "Sequence").id',
	);
	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(DASHBOARD)}), { state: { mode: "source" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		leaf.view.editor.setCursor({ line: 0, ch: 0 });
		await navigator.clipboard.writeText("before the run");
		return true;
	})()`);
	expect(await obsidian.execJson("quickadd:run", { id, vars: JSON.stringify({ value: "from the dashboard" }) }))
		.toMatchObject({ ok: true });

	const read = (path: string) =>
		obsidian.dev.evalJsonAsync<string>(`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(path)}))`);
	await expect.poll(() => read(INBOX), POLL_OPTS).toBe("# Inbox\nfrom the dashboard");
	await expect.poll(() => read(DASHBOARD), POLL_OPTS).toBe("# Dashboard\n[[Inbox]]");
	expect(await obsidian.dev.evalJsonAsync<string>("navigator.clipboard.readText()")).toBe("[[Inbox]]");
});

it("turns a capture into a sequence from its Steps with Run Templater", async () => {
	const { obsidian, plugin } = getContext();
	const capture = new CaptureChoice("Log");
	capture.captureTo = INBOX;
	capture.prepend = true;
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [capture];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await clickWhenStill(obsidian, '[aria-label="Configure Log"]');
	await expect.poll(() => pageTitles(obsidian), POLL_OPTS).toEqual(["Log"]);
	await addStep(obsidian, "Run Templater");

	await waitForElement(obsidian, ".macroBuilder");
	await expect.poll(() => rows(obsidian), POLL_OPTS).toEqual([
		["Log", "Adds a line at the bottom of Inbox"],
		["Run Templater", "Runs Templater on it"],
	]);
	expect(await lede(obsidian)).toBe("Adds a line at the bottom of Inbox, runs Templater on it");
});
