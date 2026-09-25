import { expect, it } from "vitest";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("picker-position");

type Layout = { centerY: number; inputTop: number; windowCenterY: number };

const measure = (selector: string) => `(() => {
	const el = document.querySelector(${JSON.stringify(selector)});
	const box = el.getBoundingClientRect();
	return {
		centerY: box.top + box.height / 2,
		inputTop: el.querySelector('input').getBoundingClientRect().top,
		windowCenterY: window.innerHeight / 2,
	};
})()`;

it("opens a Multi's picker centered like the value prompt that follows it (#1796)", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const templatePath = await seedVaultFile(obsidian, sandbox, "Picker template.md");
	const folder = new MultiChoice("Picker position");
	for (const name of ["AI Context", "Topic", "Person", "Blank"]) {
		const template = new TemplateChoice(name);
		template.templatePath = templatePath;
		template.fileNameFormat = { enabled: true, format: "{{VALUE:Title}}" };
		folder.addChoice(template);
	}
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [folder];
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJson(`(() => {
		void app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(folder.name)}).catch(() => {});
		return true;
	})()`);

	await waitForElement(obsidian, ".prompt .suggestion-item");
	const picker = await obsidian.dev.evalJson<Layout>(measure(".prompt"));
	expect(Math.abs(picker.centerY - picker.windowCenterY)).toBeLessThan(2);

	// Filtering shrinks the list; the input must not move under the cursor.
	await typeInto(obsidian, ".prompt input", "Topic");
	await expect.poll(() => obsidian.dev.evalJson<number>(
		"document.querySelectorAll('.prompt .suggestion-item').length",
	), POLL_OPTS).toBe(1);
	const filtered = await obsidian.dev.evalJson<Layout>(measure(".prompt"));
	expect(filtered.inputTop).toBe(picker.inputTop);

	await pressKey(obsidian, "Enter");
	await waitForElement(obsidian, ".qaInputPrompt .modal");
	const valuePrompt = await obsidian.dev.evalJson<Layout>(measure(".qaInputPrompt .modal"));
	expect(Math.abs(valuePrompt.centerY - picker.centerY)).toBeLessThan(2);
	await pressKey(obsidian, "Escape");
});
