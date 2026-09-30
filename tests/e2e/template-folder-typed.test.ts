import { expect, it } from "vitest";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { clickAt, POLL_OPTS, typeInto } from "./uiHelpers";

// #1993: a folder typed into "Folder path" and never added with the Add button
// was dropped when the builder closed, leaving a "specific folder" choice with
// no folder.
const getContext = createQuickAddE2EHarness("template-folder-typed");

it("keeps a folder typed without Add when the builder closes with Done", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const templatePath = await seedVaultFile(obsidian, sandbox, "Meeting template.md", "# Meeting\n");
	const folder = sandbox.path("Meetings");
	const choice = new TemplateChoice("Typed folder template");
	choice.templatePath = templatePath;
	choice.folder = { ...choice.folder, enabled: true, folders: [] };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.dev.evalJson(`(() => {
			app.setting.open(); app.setting.openTabById("quickadd");
			[...document.querySelectorAll('[aria-label="Configure ${choice.name}"]')]
				.find(el => el.getClientRects().length > 0).click();
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			`Boolean(document.querySelector(".templateChoiceBuilder .qa-folder-path-input"))`,
		), POLL_OPTS).toBe(true);

		await typeInto(obsidian, ".templateChoiceBuilder .qa-folder-path-input", folder);
		const done = await obsidian.dev.evalJson<{ x: number; y: number }>(`(() => {
			const button = [...document.querySelectorAll(".templateChoiceBuilder button")]
				.find(b => b.textContent?.trim() === "Done");
			const rect = button.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		})()`);
		await clickAt(obsidian, done.x, done.y);

		await expect.poll(() => obsidian.dev.evalJson<string[] | undefined>(
			`app.plugins.plugins.quickadd.settings.choices.find(c => c.id === ${JSON.stringify(choice.id)})?.folder.folders`,
		), POLL_OPTS).toEqual([folder]);

		await obsidian.exec("quickadd:run", { choice: choice.name, "value-value": "Weekly sync" });
		await expect.poll(() => sandbox.read("Meetings/Weekly sync.md").then(() => true, () => false), POLL_OPTS).toBe(true);
	} finally {
		await obsidian.dev.evalJson(`(() => {
			for (const builder of document.querySelectorAll(".templateChoiceBuilder")) {
				[...builder.querySelectorAll("button")].find(b => b.textContent?.trim() === "Done")?.click();
			}
			app.setting.close();
			return true;
		})()`);
	}
});
