import { expect, it } from "vitest";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { addStep, leaveSettingsPage, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// #941/#942: two `view.js` files in different folders were identical "view" rows
// in the script pickers, and picking the second one saved the first. Each must be findable by path, saved under its own path, and
// run as itself.
const getContext = createQuickAddE2EHarness("script-picker-paths");

it("adds same-named scripts by path from the script picker, and runs each", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	// Each script records its own name, so a run shows which file executed.
	const books = await seedVaultFile(obsidian, sandbox, "views/books/view.js",
		'module.exports = () => { (window.__qaScriptPickerRuns ??= []).push("books"); };');
	const progress = await seedVaultFile(obsidian, sandbox, "views/qa-progress-panel/view.js",
		'module.exports = () => { (window.__qaScriptPickerRuns ??= []).push("progress"); };');
	const runner = await seedVaultFile(obsidian, sandbox, "views/runner.md",
		"# Weekly runner\n\n```js\nmodule.exports = () => {};\n```\n");
	const macro = new MacroChoice("Script picker paths");
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [macro];
	}));
	await plugin.reload({ waitUntilReady: true });

	// Settings in the main window, as in conditional-branch-persistence.test.ts:
	// the popout's DOM adoption is nondeterministic under CLI automation.
	const popout = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('settingsPopoutWindow') ?? true");
	await obsidian.dev.evalJson("app.vault.setConfig('settingsPopoutWindow', false), true");
	const click = (selector: string, text?: string) => obsidian.dev.evalJson<boolean>(`(() => {
		const target = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
			.filter((el) => ${JSON.stringify(text ?? null)} === null || el.textContent.trim() === ${JSON.stringify(text ?? null)})
			.pop();
		target?.click();
		return Boolean(target);
	})()`);
	const texts = (selector: string) => obsidian.dev.evalJson<string[]>(
		`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((el) => el.textContent)`,
	);
	const browseRows = () => obsidian.dev.evalJson<Array<{ title: string; note: string }>>(`
		Array.from(document.querySelectorAll(".prompt .suggestion-item")).map((row) => ({
			title: row.querySelector(".suggestion-title")?.textContent ?? row.textContent,
			note: row.querySelector(".suggestion-note")?.textContent ?? "",
		}))
	`);

	try {
		await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
		await expect.poll(() => click(`[aria-label="Configure ${macro.name}"]`), POLL_OPTS).toBe(true);

		// #1878: a macro without steps has no blank list area above the buttons.
		await expect.poll(() => obsidian.dev.evalJson<number>(
			'document.querySelector(".macroBuilder .quickAddCommandList").getBoundingClientRect().height',
		), POLL_OPTS).toBe(0);

		// #1883: the icon picker ranks the exact icon first (real Obsidian scorer).
		expect(await click('.macroBuilder button[aria-label="More settings"]')).toBe(true);
		await typeInto(obsidian, ".macroBuilder .qa-choice-icon-input", "star");
		await expect.poll(async () => (await texts(".suggestion-container .suggestion-item"))[0], POLL_OPTS).toBe("star");
		await pressKey(obsidian, "Escape");

		// Searching the picker: same-named scripts are listed by path, and the
		// picked one is the one that gets added.
		// Real clicks on a still menu: Obsidian takes a menu's keys a tick after it
		// shows it, so an item clicked sooner leaves the closed menu's keys above
		// the picker, and they swallow its Enter.
		const runAScript = async () => {
			await addStep(obsidian, "Run a script");
			await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".prompt .prompt-input"))'), POLL_OPTS).toBe(true);
		};
		await runAScript();
		await typeInto(obsidian, ".prompt .prompt-input", "qa-progress");
		await expect.poll(browseRows, POLL_OPTS).toEqual([{ title: "view.js", note: progress }]);
		await pressKey(obsidian, "Enter");
		await expect.poll(() => texts(".macroBuilder .quickAddCommandLabel"), POLL_OPTS).toEqual([progress]);

		// Rows show each script's path, and search matches it.
		await runAScript();
		await expect.poll(async () => (await browseRows()).filter((row) => row.note === books || row.note === progress), POLL_OPTS)
			.toEqual(expect.arrayContaining([
				{ title: "view.js", note: books },
				{ title: "view.js", note: progress },
			]));
		// #1932: a note script's row shows its heading, and typing that heading finds it.
		await typeInto(obsidian, ".prompt .prompt-input", "weekly runner");
		await expect.poll(browseRows, POLL_OPTS).toEqual([{ title: "Weekly runner", note: runner }]);
		await typeInto(obsidian, ".prompt .prompt-input", "books");
		await expect.poll(browseRows, POLL_OPTS).toEqual([{ title: "view.js", note: books }]);
		// The row highlights the match, as the quick switcher does.
		expect(await texts(".prompt .suggestion-item .suggestion-highlight")).toEqual(["books"]);
		// Obsidian selects the first row a tick after it renders; Enter before
		// that chooses nothing.
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".prompt .suggestion-item.is-selected")?.textContent?.includes("books"))',
		), POLL_OPTS).toBe(true);
		await pressKey(obsidian, "Enter");

		await expect.poll(() => texts(".macroBuilder .quickAddCommandLabel"), POLL_OPTS).toEqual([progress, books]);
		// Leaving the builder saves through a debounce; wait for it on disk so the
		// harness's data restore can't race it.
		await leaveSettingsPage(obsidian);
		await expect.poll(() => obsidian.dev.evalJsonAsync<unknown>(`(async () => {
			const p = app.plugins.plugins.quickadd;
			const data = JSON.parse(await app.vault.adapter.read(p.manifest.dir + "/data.json"));
			return data.actions[0].steps.map((step) => step.path);
		})()`), POLL_OPTS).toEqual([progress, books]);
	} finally {
		await obsidian.dev.evalJson(`(() => { app.setting.close(); app.vault.setConfig('settingsPopoutWindow', ${popout}); return true; })()`);
	}

	await obsidian.dev.evalJson("(() => { window.__qaScriptPickerRuns = []; return true; })()");
	await obsidian.exec("quickadd:run", { choice: macro.name });
	await expect.poll(() => obsidian.dev.evalJson<string[]>("window.__qaScriptPickerRuns"), POLL_OPTS)
		.toEqual(["progress", "books"]);
});
