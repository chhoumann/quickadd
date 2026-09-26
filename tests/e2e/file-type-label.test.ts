import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, expectNoPrompt, pressKey, typeInto, waitForElement } from "./uiHelpers";

// Two `{{FILE:<folder>|type:...}}` pickers on one folder and mode get default
// labels that name their type, so a one-page form can tell them apart.
const getContext = createQuickAddE2EHarness("file-type-label");

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
};

async function closeOpenPrompts() {
	const { obsidian } = getContext();
	for (let remaining = 10; remaining > 0; remaining--) {
		if (!await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container, .prompt"))')) break;
		await pressKey(obsidian, "Escape");
	}
	await expectNoPrompt(obsidian);
}

beforeEach(closeOpenPrompts);
afterEach(closeOpenPrompts);

async function pick(selector: string, typed: string, expected: string) {
	const { obsidian } = getContext();
	// A single picker preselects its first file and hides picked files from
	// its suggestions, so clear it before searching.
	await obsidian.dev.evalJson(`document.querySelector(${JSON.stringify(selector)})
		?.closest(".qa-onepage-file-picker")
		?.querySelectorAll(".qa-onepage-file-picker__remove")
		.forEach((button) => button.click())`);
	await typeInto(obsidian, selector, typed);
	// A suggestion reads as the file name followed by its path.
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`document.querySelector(".suggestion-container .suggestion-item")?.textContent?.startsWith(${JSON.stringify(expected)}) ?? false`,
	), POLL_OPTS).toBe(true);
	await pressKey(obsidian, "Enter");
}

describe("FILE |type: default label", () => {
	it("names each one-page attachment picker after its type", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, "Attachments/photo.png", "png");
		await seedVaultFile(obsidian, sandbox, "Attachments/scan.pdf", "pdf");
		const folder = sandbox.path("Attachments");
		const template = new TemplateChoice("Attachment pair");
		template.command = true;
		template.templatePath = await seedVaultFile(
			obsidian,
			sandbox,
			"attachment-template.md",
			`image: {{FILE:${folder}|type:image|link}}\npdf: {{FILE:${folder}|type:pdf|link}}\n`,
		);
		template.fileNameFormat = { enabled: true, format: "attachment pair" };
		template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = true;
			data.choices.push(template);
		});
		await plugin.reload({ waitUntilReady: true });
		await obsidian.exec("command", { id: `quickadd:choice:${template.id}` });

		await waitForElement(obsidian, ".onePageInputModal");
		expect(await obsidian.dev.evalJson<string[]>(
			'Array.from(document.querySelectorAll(".onePageInputModal .setting-item-name")).map((name) => name.textContent)',
		)).toEqual([
			`File from ${folder} (image, link)`,
			`File from ${folder} (pdf, link)`,
		]);

		const field = (qualifiers: string) =>
			`.onePageInputModal input[aria-label=${JSON.stringify(
				`Choose file for File from ${folder} (${qualifiers})`,
			)}]`;
		await pick(field("image, link"), "pho", "photo.png");
		await pick(field("pdf, link"), "sca", "scan.pdf");
		await pressKey(obsidian, "Enter", true);
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("out/attachment pair.md").catch(() => ""), POLL_OPTS)
			.toMatch(/^image: \[\[[^\]]+\]\]\npdf: \[\[[^\]]+\]\]\n$/);
		// Link text follows the vault's link format, so check where each link lands.
		const note = JSON.stringify(sandbox.path("out/attachment pair.md"));
		await expect.poll(() => obsidian.dev.evalJson<(string | null)[] | null>(`(() => {
			const file = app.vault.getAbstractFileByPath(${note});
			return app.metadataCache.getFileCache(file)?.links?.map(({ link }) =>
				app.metadataCache.getFirstLinkpathDest(link, ${note})?.path ?? null) ?? null;
		})()`), POLL_OPTS).toEqual([`${folder}/photo.png`, `${folder}/scan.pdf`]);
	});
});
