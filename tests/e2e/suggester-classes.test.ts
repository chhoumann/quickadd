import { it } from "vitest";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { pressKey, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("suggester-classes");

// Users target these classes from CSS snippets (docs: ControllingPrompts
// "Style pickers with CSS"), so renaming one breaks their themes.
it("marks QuickAdd's pickers with the documented CSS classes", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const folder = new MultiChoice("Styled folder").addChoice(new TemplateChoice("Styled template"));
	const discovery = new TemplateChoice("Styled discovery");
	discovery.discoverExistingNotesBeforeCreate = true;
	discovery.templatePath = await seedVaultFile(obsidian, sandbox, "Styled discovery template.md");
	discovery.fileNameFormat = { enabled: true, format: "{{VALUE}}" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [folder, discovery];
	});
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson(`(() => {
		void app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(folder.name)}).catch(() => {});
		return true;
	})()`);
	await waitForElement(obsidian, ".prompt.qa-choice-suggester .suggestion-item");
	await pressKey(obsidian, "Escape");

	await obsidian.dev.evalJson(`(() => {
		void app.plugins.plugins.quickadd.api.suggester(["low", "high"], ["low", "high"]).catch(() => {});
		return true;
	})()`);
	await waitForElement(obsidian, ".prompt.qa-suggester .suggestion-item");
	await pressKey(obsidian, "Escape");

	await obsidian.dev.evalJson(`(() => {
		void app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(discovery.name)}).catch(() => {});
		return true;
	})()`);
	await waitForElement(obsidian, '.prompt.qa-suggester input[placeholder^="Search notes or create"]');
	await pressKey(obsidian, "Escape");
});
