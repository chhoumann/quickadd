import { expect, it } from "vitest";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// #942: the macro builder's Browse picker listed several `view.js` files as
// identical "view" rows. Each row must show its path, and search must match it.
const getContext = createQuickAddE2EHarness("script-picker-paths");

it("shows and searches script paths in the macro builder's Browse picker", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const books = await seedVaultFile(obsidian, sandbox, "views/books/view.js", "module.exports = () => {};");
	const progress = await seedVaultFile(obsidian, sandbox, "views/qa-progress-panel/view.js", "module.exports = () => {};");
	const macro = new MacroChoice("Script picker paths");
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [macro];
	});
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
	const rows = () => obsidian.dev.evalJson<Array<{ title: string; note: string }>>(`
		Array.from(document.querySelectorAll(".prompt .suggestion-item")).map((row) => ({
			title: row.querySelector(".suggestion-title")?.textContent ?? row.textContent,
			note: row.querySelector(".suggestion-note")?.textContent ?? "",
		}))
	`);

	try {
		await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
		await expect.poll(() => click(`[aria-label="Configure ${macro.name}"]`), POLL_OPTS).toBe(true);
		await expect.poll(() => click(".macroBuilder button", "Browse"), POLL_OPTS).toBe(true);

		await expect.poll(async () => (await rows()).filter((row) => row.note === books || row.note === progress), POLL_OPTS)
			.toEqual(expect.arrayContaining([
				{ title: "view.js", note: books },
				{ title: "view.js", note: progress },
			]));

		await typeInto(obsidian, ".prompt .prompt-input", "qa-progress");
		await expect.poll(rows, POLL_OPTS).toEqual([{ title: "view.js", note: progress }]);
		await pressKey(obsidian, "Enter");

		await expect.poll(() => obsidian.dev.evalJson<string[]>(
			`Array.from(document.querySelectorAll(".macroBuilder .quickAddCommandLabel")).map((el) => el.textContent)`,
		), POLL_OPTS).toEqual(["view"]);
		await pressKey(obsidian, "Escape");
		await expect.poll(() => obsidian.dev.evalJson<unknown>(
			`app.plugins.plugins.quickadd.settings.choices[0].macro.commands.map((c) => c.path)`,
		), POLL_OPTS).toEqual([progress]);
	} finally {
		await obsidian.dev.evalJson(`(() => { app.setting.close(); app.vault.setConfig('settingsPopoutWindow', ${popout}); return true; })()`);
	}
});
