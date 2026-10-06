import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, POLL_OPTS } from "./uiHelpers";

// A Template whose file has Templater tags says so on its compact page: a
// badge under the Template field, and Templater's prompts in the Inputs group.
const withTemplater = process.env.OBSIDIAN_E2E_TEMPLATER === "1";

describe("a template that uses Templater", () => {
	const getContext = createQuickAddE2EHarness("v3-templater-inputs");

	beforeAll(async () => {
		// A reused instance may still run the Templater an earlier variant run enabled.
		expect(await getContext().obsidian.dev.evalJsonAsync<boolean>(`(async () => {
			if (!${withTemplater}) await app.plugins.disablePlugin("templater-obsidian");
			return Boolean(app.plugins.plugins["templater-obsidian"]);
		})()`)).toBe(withTemplater);
	});

	afterEach(async () => {
		await getContext().obsidian.dev.evalJson("app.setting.close(), true");
	});

	const openDinner = async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const template = new TemplateChoice("Dinner");
		template.templatePath = await seedVaultFile(
			obsidian,
			sandbox,
			"Dinner template.md",
			'# <% tp.system.prompt("Guest") %>\n\nTopic: {{VALUE:Topic}}\n',
		);
		template.fileNameFormat = { enabled: true, format: "Dinner {{DATE:YYYY-MM-DD}}" };
		await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
			data.choices = [template];
		}));
		await plugin.reload({ waitUntilReady: true });
		await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
		await clickWhenStill(obsidian, '[aria-label="Configure Dinner"]');
	};

	const read = <T>(code: string) => getContext().obsidian.dev.evalJson<T>(code);
	const badge = () => read<string>(
		'document.querySelector(".qa-builder-page .qaTemplaterBadge")?.innerText.replace(/\\s+/g, " ").trim() ?? ""',
	);
	const lede = () => read<string>('document.querySelector(".qa-builder-page .qaChoiceSummary")?.innerText.trim() ?? ""');
	const inputRows = () => read<string[]>(`[...document.querySelectorAll(".qa-builder-page .qaInputRow")]
		.map((row) => row.querySelector(".setting-item-info").innerText.replace(/\\s+/g, " ").trim())`);

	it.runIf(withTemplater)("says Templater runs after the note is created, and lists its prompt after QuickAdd's", async () => {
		await openDinner();

		await expect.poll(badge, POLL_OPTS).toBe("Templater runs after the note is created");
		expect(await read<string>(
			'document.querySelector(".qa-builder-page .qaTemplaterBadge svg")?.getAttribute("class") ?? ""',
		)).toBe("svg-icon templater-icon");
		expect(await lede()).toBe("Creates Dinner {date} from Dinner template, runs Templater");
		await expect.poll(inputRows, POLL_OPTS).toEqual([
			"Topic value Defined in Dinner template.md",
			"Guest Asked by Templater, in Dinner template.md",
		]);
		expect(await read<number>(
			'document.querySelectorAll(".qa-builder-page .qaInputRow[data-input=\\"Guest\\"] input, .qa-builder-page .qaInputRow[data-input=\\"Guest\\"] [role=switch]").length',
		)).toBe(0);
	});

	it.skipIf(withTemplater)("says the template uses Templater, which is not installed", async () => {
		await openDinner();

		await expect.poll(badge, POLL_OPTS).toBe("This template uses Templater, which is not installed");
		expect(await read<string>(
			'document.querySelector(".qa-builder-page .qaTemplaterBadge a")?.getAttribute("href") ?? ""',
		)).toBe("obsidian://show-plugin?id=templater-obsidian");
		expect(await lede()).toBe("Creates Dinner {date} from Dinner template");
	});
});
