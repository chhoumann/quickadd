import { expect, it } from "vitest";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type { ICommand } from "../../src/types/macros/ICommand";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, pressKey, waitForElement } from "./uiHelpers";

// The picker renders plain names without Obsidian's Markdown renderer (#2251),
// so each row has to match what that renderer makes of the same name.
const getContext = createQuickAddE2EHarness("choice-name-render");

const NAMES = [
	"Daily note",
	"Daily note - work (inbox), v1.2; ok?",
	"\"Quoted\" isn't markdown",
	"1.5 hours",
	"Café 📅 → ünïcode",
	"**Bold** note",
];

it("renders each picker row as Obsidian's Markdown renderer renders its name", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = await seedVaultFile(obsidian, sandbox, "keep-obsidian.js",
		"module.exports = async ({ obsidian }) => { window.__qaObsidian = obsidian; };");
	const keep = new MacroChoice("Keep obsidian module");
	keep.macro.commands = [{ id: "keep-obsidian", name: "keep", type: "UserScript", path: script, settings: {} } as ICommand];
	await plugin.data<{ choices: unknown[] }>().patch((data) => {
		data.choices = [keep, ...NAMES.map((name) => new TemplateChoice(name))];
	});
	await plugin.reload({ waitUntilReady: true });
	const run = await obsidian.execJson<{ ok: boolean }>("quickadd:run", { id: keep.id });
	expect(run, JSON.stringify(run)).toMatchObject({ ok: true });

	await obsidian.dev.evalJson('(app.commands.executeCommandById("quickadd:runQuickAdd"), true)');
	try {
		await waitForElement(obsidian, ".qa-choice-suggester .quickadd-choice-suggestion-title");
		const rows = await obsidian.dev.evalJsonAsync<{ name: string; row: string; renderer: string }[]>(`(async () => {
			const { MarkdownRenderer, Component } = window.__qaObsidian;
			const component = new Component();
			component.load();
			const titles = [...document.querySelectorAll(".qa-choice-suggester .quickadd-choice-suggestion-title")];
			const rows = [];
			for (const name of ${jsLiteral(NAMES)}) {
				const title = titles.find((el) => el.textContent === name.replace(/\\*\\*/g, ""));
				const rendered = document.createElement("div");
				await MarkdownRenderer.render(app, name, rendered, "/", component);
				rows.push({ name, row: title?.innerHTML ?? "missing", renderer: rendered.innerHTML });
			}
			component.unload();
			delete window.__qaObsidian;
			return rows;
		})()`);

		for (const { name, row, renderer } of rows) {
			expect(row, name).toBe(renderer);
		}
	} finally {
		await pressKey(obsidian, "Escape");
	}
});
