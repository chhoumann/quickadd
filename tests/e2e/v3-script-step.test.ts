import { afterEach, beforeEach, expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { UserScript } from "../../src/types/macros/UserScript";
import type { Action, ActionNode, RunScriptStep } from "../../src/v3/model";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, jsLiteral, leaveSettingsPage, POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";

// A script step's row says which file it runs, or that it has none, and a step
// without a runnable file gets one picked from the row.
const getContext = createQuickAddE2EHarness("v3-script-step");

type Data = { choices: IChoice[]; actions: ActionNode[] };

const HELLO = "module.exports = () => { window.__qaHello = (window.__qaHello ?? 0) + 1; };";

beforeEach(async () => {
	await getContext().obsidian.dev.evalJson("(() => { delete window.__qaHello; return true; })()");
});

afterEach(async () => {
	await getContext().obsidian.dev.evalJson("(() => { app.setting.close(); delete window.__qaHello; return true; })()");
});

/** What each step row says under its name, and the file it names on hover. */
const rowDetail = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson<string[][]>(
		'[...document.querySelectorAll(".macroBuilder .quickAddCommandListItem .quickAddCommandDetail")].map((el) => [el.textContent, el.title])',
	);

async function chooseFile(obsidian: ObsidianClient, stepName: string, query: string) {
	await clickWhenStill(obsidian, `[aria-label=${jsLiteral(`Choose file for ${stepName}`)}]`);
	await waitForElement(obsidian, ".prompt .prompt-input");
	await typeInto(obsidian, ".prompt .prompt-input", query);
	await waitForElement(obsidian, ".prompt .suggestion-item.is-selected");
	await pressKey(obsidian, "Enter");
}

async function storedAction(read: () => Promise<Data>, name: string) {
	return (await read()).actions.find((node): node is Action => node.name === name);
}

it("adds a script from its preset and runs the file chosen on its row", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const hello = await seedVaultFile(obsidian, sandbox, "scripts/hello.js", HELLO);
	// Patching first also has the harness put data.json back after the test.
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await clickWhenStill(obsidian, ".qaFirstRun .qaNewChoiceBtn");
	await waitForElement(obsidian, ".menu .menu-item");
	await obsidian.dev.evalJson(`(() => {
		const item = [...document.querySelectorAll(".menu .menu-item")]
			.find((el) => el.textContent.trim().startsWith("Run a script"));
		item.setAttribute("data-qa-preset", "script");
		return true;
	})()`);
	await clickWhenStill(obsidian, '.menu-item[data-qa-preset="script"]');

	await expect.poll(() => rowDetail(obsidian), POLL_OPTS).toEqual([["No file chosen", ""]]);
	await chooseFile(obsidian, "Script", "hello.js");
	await expect.poll(() => rowDetail(obsidian), POLL_OPTS).toEqual([["Runs hello.js", hello]]);
	await leaveSettingsPage(obsidian);

	const read = () => plugin.data<Data>().read();
	await expect.poll(
		async () => (await storedAction(read, "Script"))?.steps.map((step) => [step.type, (step as RunScriptStep).path]),
		POLL_OPTS,
	).toEqual([["runScript", hello]]);
	const id = (await storedAction(read, "Script"))!.id;
	await expect.poll(() => obsidian.dev.evalJson<string | null>(
		`document.querySelector(${jsLiteral(`[data-choice-id="${id}"] .choiceListItemSummary`)})?.textContent ?? null`,
	), POLL_OPTS).toBe("Runs hello.js");

	await obsidian.dev.evalJson("app.setting.close(), true");
	expect(await obsidian.execJson("quickadd:run", { id })).toMatchObject({ ok: true });
	expect(await obsidian.dev.evalJson<number | null>("window.__qaHello ?? null")).toBe(1);
});

it("points a step whose script was moved at a file chosen on its row", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const hello = await seedVaultFile(obsidian, sandbox, "scripts/hello.js", HELLO);
	const moved = sandbox.path("scripts/moved.js");
	const macro = new MacroChoice("Moved script");
	macro.macro.commands.push(new UserScript("moved", moved));
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [macro];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await clickWhenStill(obsidian, '[aria-label="Configure Moved script"]');
	await expect.poll(() => rowDetail(obsidian), POLL_OPTS).toEqual([[`Can't find ${moved}`, moved]]);
	await chooseFile(obsidian, "moved", "hello.js");
	await expect.poll(() => rowDetail(obsidian), POLL_OPTS).toEqual([["Runs hello.js", hello]]);
	await leaveSettingsPage(obsidian);

	const read = () => plugin.data<Data>().read();
	await expect.poll(
		async () => (await storedAction(read, "Moved script"))?.steps.map((step) => (step as RunScriptStep).path),
		POLL_OPTS,
	).toEqual([hello]);

	await obsidian.dev.evalJson("app.setting.close(), true");
	expect(await obsidian.execJson("quickadd:run", { id: macro.id })).toMatchObject({ ok: true });
	expect(await obsidian.dev.evalJson<number | null>("window.__qaHello ?? null")).toBe(1);
});
