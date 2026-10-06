import { afterEach, beforeEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { closeOpenPrompts, jsLiteral, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("picker-labels");

beforeEach(() => closeOpenPrompts(getContext().obsidian));
afterEach(() => closeOpenPrompts(getContext().obsidian));

it("labels readable notes by file name and ID-named notes by their first H1", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const garden = await seedVaultFile(obsidian, sandbox, "Notes/Garden plan.md",
		"# Log\n\n# Ideas\n");
	const daily = await seedVaultFile(obsidian, sandbox, "Notes/2026-10-06.md", "# Log\n");
	const zettel = await seedVaultFile(obsidian, sandbox, "Notes/202610061432.md",
		"# Coffee brewing ratios\n\n# References\n");

	const choice = new CaptureChoice("Picker labels");
	choice.command = true;
	choice.captureTo = `${sandbox.path("Notes")}/`;
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "- captured\n" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	await expect.poll(() => obsidian.dev.evalJson<number[]>(`
		${jsLiteral([garden, daily, zettel])}.map((path) =>
			app.metadataCache.getCache(path)?.headings?.length ?? 0)
	`), POLL_OPTS).toEqual([2, 1, 2]);

	const prompt = ".prompt .prompt-input";
	const titles = () => obsidian.dev.evalJson<string[]>(`
		Array.from(
			Array.from(document.querySelectorAll(".prompt")).at(-1)?.querySelectorAll(".suggestion-title") ?? [],
			(title) => title.textContent,
		)
	`);
	const read = (path: string) => obsidian.dev.evalJsonAsync<string>(
		`app.vault.adapter.read(${jsLiteral(path)})`,
	);

	await obsidian.command(`quickadd:choice:${choice.id}`).run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${jsLiteral(prompt)}))`), POLL_OPTS).toBe(true);
	await expect.poll(async () => (await titles()).sort(), POLL_OPTS)
		.toEqual(["2026-10-06", "Coffee brewing ratios", "Garden plan"]);

	await typeInto(obsidian, prompt, "garden");
	await expect.poll(titles, POLL_OPTS).toEqual(["Garden plan"]);
	await pressKey(obsidian, "Enter");
	await expect.poll(() => read(garden), POLL_OPTS).toContain("- captured");
	expect(await read(daily)).toBe("# Log\n");
});
