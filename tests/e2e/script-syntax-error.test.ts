import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { UserScript } from "../../src/types/macros/UserScript";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, leaveSettingsPage, POLL_OPTS } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("script-syntax-error");

const noticeTexts = `Array.from(document.querySelectorAll(".notice"), (n) => n.textContent)`;
const clearNotices = `(() => { for (const n of document.querySelectorAll(".notice")) n.remove(); return true; })()`;

it("names the file and line of a user script syntax error on run, in the CLI, and on the settings cog", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const path = await seedVaultFile(
		obsidian,
		sandbox,
		"broken-syntax.js",
		"module.exports = async (params) => {\n\tconst x = ;\n};\nmodule.exports.settings = { name: 'x', options: {} };\n",
	);
	const detail = `${path} because it has a syntax error on line 2: Unexpected token ';'. Fix the script and run it again.`;
	const macro = new MacroChoice("Broken script");
	macro.command = true;
	macro.macro.commands.push(new UserScript("broken-syntax", path));
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [macro];
	});
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson(
		`(() => { app.commands.executeCommandById(${jsLiteral(`quickadd:choice:${macro.id}`)}); return true; })()`,
	);
	await expect.poll(() => obsidian.dev.evalJson<string[]>(noticeTexts), POLL_OPTS).toEqual([
		`QuickAdd: (ERROR) Could not load ${detail}`,
	]);

	const cli = await obsidian.execJson<{ ok: boolean; error?: string }>("quickadd:run", { id: macro.id });
	expect(cli).toMatchObject({ ok: false, error: `QuickAdd could not load ${detail}` });

	await obsidian.dev.evalJson(clearNotices);
	const popout = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('settingsPopoutWindow') ?? true");
	await obsidian.dev.evalJson("app.vault.setConfig('settingsPopoutWindow', false), true");
	try {
		await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(`(() => {
			const b = document.querySelector('[aria-label="Configure ${macro.name}"]'); b?.click(); return Boolean(b);
		})()`), POLL_OPTS).toBe(true);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(`(() => {
			const b = document.querySelector('.macroBuilder [aria-label="Configure broken-syntax"]'); b?.click(); return Boolean(b);
		})()`), POLL_OPTS).toBe(true);
		await expect.poll(() => obsidian.dev.evalJson<string[]>(noticeTexts), POLL_OPTS).toEqual([
			`QuickAdd: (ERROR) Could not load ${detail}`,
		]);
		await leaveSettingsPage(obsidian);
	} finally {
		await obsidian.dev.evalJson(`(() => { app.setting.close(); app.vault.setConfig('settingsPopoutWindow', ${popout}); return true; })()`);
	}
});
