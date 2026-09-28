import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { UserScript } from "../../src/types/macros/UserScript";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { expectNoPrompt, jsLiteral, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// Discussion #763: a Macro that re-runs a Capture until Escape, for quick
// brain dumps. Every re-opened prompt must start empty, and stopping the loop
// must not leave the last entry behind to pre-fill the next capture.
const getContext = createQuickAddE2EHarness("repeat-capture-drafts");

const INPUT = ".qaInputPrompt input";

async function openPromptValue(): Promise<string> {
	const { obsidian } = getContext();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`document.activeElement?.matches(${jsLiteral(INPUT)}) ?? false`,
	), POLL_OPTS).toBe(true);
	return obsidian.dev.evalJson<string>(`document.querySelector(${jsLiteral(INPUT)}).value`);
}

it("a capture re-run from a Macro loop opens empty every time, including after Escape", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "# Inbox\n");

	const capture = new CaptureChoice("Repeat capture inbox");
	capture.captureTo = inbox;
	capture.onePageInput = "never";
	capture.format = { enabled: true, format: "- {{VALUE}}" };

	const script = await seedVaultFile(
		obsidian, sandbox, "Scripts/repeat.js",
		`module.exports = async ({ quickAddApi }) => {
			while (true) await quickAddApi.executeChoice(${jsLiteral(capture.name)});
		};`,
	);
	const macro = new MacroChoice("Repeat capture loop");
	macro.onePageInput = "never";
	macro.macro.commands.push(new UserScript("repeat", script));

	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [capture, macro];
	});
	await plugin.reload({ waitUntilReady: true });

	const run = (name: string) => obsidian.dev.evalJson(
		`(() => { void app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(name)}); return true; })()`,
	);
	const inboxContent = () => obsidian.dev.evalJsonAsync<string>(
		`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(inbox)}))`,
	);

	await run(macro.name);
	const seen: string[] = [];
	for (const entry of ["first entry", "second entry"]) {
		seen.push(await openPromptValue());
		await typeInto(obsidian, INPUT, entry);
		await pressKey(obsidian, "Enter");
		await expect.poll(inboxContent, POLL_OPTS).toContain(`- ${entry}`);
	}
	seen.push(await openPromptValue());
	await pressKey(obsidian, "Escape");
	await expectNoPrompt(obsidian);

	await run(capture.name);
	seen.push(await openPromptValue());
	await pressKey(obsidian, "Escape");
	await expectNoPrompt(obsidian);

	expect(seen).toEqual(["", "", "", ""]);
});
