import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// The one-page form asks for a folder capture's note in a searchable field,
// which finds notes by alias like the run's picker, instead of a dropdown of
// every note in the folder.
const getContext = createQuickAddE2EHarness("one-page-capture-target");

it("picks the one-page capture target by searching, aliases included", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const thomas = await seedVaultFile(obsidian, sandbox, "People/Thomas Anderson.md",
		"---\naliases: [Neo, The One]\n---\n");
	const classic = await seedVaultFile(obsidian, sandbox, "People/Neo Classic.md", "");

	const choice = new CaptureChoice("One-page capture target");
	choice.command = true;
	choice.captureTo = `${sandbox.path("People")}/`;
	choice.onePageInput = "always";
	choice.createFileIfItDoesntExist = { ...choice.createFileIfItDoesntExist, enabled: true };
	choice.format = { enabled: true, format: "- {{VALUE:note}}\n" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	const read = (path: string) => obsidian.dev.evalJsonAsync<string | null>(
		`(async () => (await app.vault.adapter.exists(${jsLiteral(path)})) ? app.vault.adapter.read(${jsLiteral(path)}) : null)()`,
	);
	const field = ".qa-onepage-file-picker input";
	await obsidian.command(`quickadd:choice:${choice.id}`).run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${jsLiteral(field)}))`), POLL_OPTS).toBe(true);
	expect(await obsidian.dev.evalJson<number>('document.querySelectorAll(".modal-container select").length')).toBe(0);

	await typeInto(obsidian, field, "the one");
	await expect.poll(() => obsidian.dev.evalJson(`
		Array.from(document.querySelectorAll(".suggestion-container .suggestion-item"), (row) => ({
			title: row.querySelector(".qa-onepage-file-suggestion__label")?.textContent,
			note: row.querySelector(".qa-onepage-file-suggestion__path")?.textContent,
			alias: Boolean(row.querySelector('[aria-label="Alias"]')),
		}))
	`), POLL_OPTS).toEqual([{ title: "The One", note: "Thomas Anderson", alias: true }]);
	await pressKey(obsidian, "Enter");
	await expect.poll(() => obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".qa-onepage-file-picker__chip-label"), (chip) => chip.textContent)',
	), POLL_OPTS).toEqual(["Thomas Anderson"]);

	await typeInto(obsidian, ".modal-container input[type=text]:not(.qa-onepage-file-picker__input)", "from the form");
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const submit = Array.from(document.querySelectorAll(".modal-container button")).find((b) => b.textContent.trim() === "Submit");
		submit?.click();
		return Boolean(submit);
	})()`)).toBe(true);
	await expect.poll(() => read(thomas), POLL_OPTS).toContain("- from the form");
	expect(await read(classic)).toBe("");
});
