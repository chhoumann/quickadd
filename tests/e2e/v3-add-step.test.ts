import { afterEach, beforeEach, expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { Action, ActionNode } from "../../src/v3/model";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, jsLiteral, leaveSettingsPage, POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";

// "My capture should also run my script": a Capture's builder adds a step,
// which turns the capture into a sequence that runs its write first.
const getContext = createQuickAddE2EHarness("v3-add-step");

type Data = { choices: IChoice[]; actions: ActionNode[] };

const HELLO = "module.exports = () => { window.__qaHello = (window.__qaHello ?? 0) + 1; };";

beforeEach(async () => {
	await getContext().obsidian.dev.evalJson("(() => { delete window.__qaHello; return true; })()");
});

afterEach(async () => {
	await getContext().obsidian.dev.evalJson("(() => { app.setting.close(); delete window.__qaHello; return true; })()");
});

/** The text of what is visible on the settings page on top. */
const visibleTexts = (obsidian: ObsidianClient, selector: string) =>
	obsidian.dev.evalJson<string[]>(`[...document.querySelectorAll(${jsLiteral(selector)})]
		.filter((el) => el.getClientRects().length > 0).map((el) => el.textContent.trim())`);

const stepLines = (obsidian: ObsidianClient) => visibleTexts(obsidian, ".qa-builder-page .qaStepsList li");
/** Each step row of the macro builder: its name, and what it says under it. */
const macroRows = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson<string[][]>(`[...document.querySelectorAll(".macroBuilder .quickAddCommandListItem")]
		.map((row) => [...row.querySelectorAll(".quickAddCommandLabel, .quickAddCommandDetail")].map((el) => el.textContent.trim()))`);

async function setUp(): Promise<{ capture: CaptureChoice; log: string; hello: string }> {
	const { obsidian, plugin, sandbox } = getContext();
	const hello = await seedVaultFile(obsidian, sandbox, "scripts/hello.js", HELLO);
	const log = await seedVaultFile(obsidian, sandbox, "log.md", "# Log\n");
	const capture = new CaptureChoice("Log");
	capture.captureTo = log;
	capture.prepend = true;
	capture.format = { enabled: true, format: "- {{VALUE}}" };
	capture.onePageInput = "never";
	// Patching first also has the harness put data.json back after the test.
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [capture];
	}));
	await plugin.reload({ waitUntilReady: true });
	return { capture, log, hello };
}

async function addScriptStep(obsidian: ObsidianClient) {
	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await clickWhenStill(obsidian, '[aria-label="Configure Log"]');
	await expect.poll(() => stepLines(obsidian), POLL_OPTS).toHaveLength(1);
	expect((await stepLines(obsidian))[0]).toMatch(/^Adds a line/);

	await clickWhenStill(obsidian, '.qa-builder-page [aria-label="Add a step"]');
	await waitForElement(obsidian, ".menu .menu-item");
	await obsidian.dev.evalJson(`(() => {
		const item = [...document.querySelectorAll(".menu .menu-item")]
			.find((el) => el.textContent.trim() === "Run a script");
		item.setAttribute("data-qa-step", "script");
		return true;
	})()`);
	await clickWhenStill(obsidian, '.menu-item[data-qa-step="script"]');
	await waitForElement(obsidian, ".macroBuilder");
}

it("adds a script to a capture, which then runs the capture and the script", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const { capture, log, hello } = await setUp();

	await addScriptStep(obsidian);
	await expect.poll(() => obsidian.dev.evalJson<string[]>("app.setting.pageStack.map((entry) => entry.page.title)"), POLL_OPTS)
		.toEqual(["Log"]);
	await expect.poll(() => macroRows(obsidian), POLL_OPTS).toEqual([["Log"], ["Script", "No file chosen"]]);

	await clickWhenStill(obsidian, '[aria-label="Choose file for Script"]');
	await waitForElement(obsidian, ".prompt .prompt-input");
	await typeInto(obsidian, ".prompt .prompt-input", "hello.js");
	await waitForElement(obsidian, ".prompt .suggestion-item.is-selected");
	await pressKey(obsidian, "Enter");
	await expect.poll(() => macroRows(obsidian), POLL_OPTS).toEqual([["Log"], ["hello", hello]]);
	await leaveSettingsPage(obsidian);

	const action = async () => (await plugin.data<Data>().read()).actions.find((node): node is Action => node.name === "Log");
	await expect.poll(async () => (await action())?.steps.map((step) => step.type), POLL_OPTS).toEqual(["addToNote", "runScript"]);
	const stored = (await action())!;
	expect(stored.id).toBe(capture.id);
	expect(stored.steps[0]).toMatchObject({ name: "Log", captureTo: log });

	const target = log.replace(/\.md$/, "");
	await expect.poll(() => obsidian.dev.evalJson<string | null>(
		`document.querySelector(${jsLiteral(`[data-choice-id="${capture.id}"] .choiceListItemSummary`)})?.textContent ?? null`,
	), POLL_OPTS).toBe(`Adds a line at the bottom of ${target}, runs hello.js`);

	await obsidian.dev.evalJson("app.setting.close(), true");
	expect(await obsidian.execJson("quickadd:run", { id: capture.id, verify: true, vars: JSON.stringify({ value: "first" }) }))
		.toMatchObject({ ok: true });
	await expect.poll(() => sandbox.read("log.md"), POLL_OPTS).toBe("# Log\n- first");
	expect(await obsidian.dev.evalJson<number | null>("window.__qaHello ?? null")).toBe(1);
});

it("shows the steps of a sequence's capture but offers no step there", async () => {
	const { obsidian } = getContext();
	await setUp();

	await addScriptStep(obsidian);
	await clickWhenStill(obsidian, '.macroBuilder [aria-label="Configure Log"]');
	await expect.poll(() => obsidian.dev.evalJson<number>("app.setting.pageStack.length"), POLL_OPTS).toBe(2);
	await expect.poll(() => stepLines(obsidian), POLL_OPTS).toHaveLength(1);
	expect((await stepLines(obsidian))[0]).toMatch(/^Adds a line/);
	expect(await visibleTexts(obsidian, '.qa-builder-page [aria-label="Add a step"]')).toEqual([]);
});
