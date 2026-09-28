import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { expectNoPrompt, jsLiteral, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// With "Persist input prompt drafts" on, text cancelled with Escape comes back
// the next time the prompt opens. Clearing that text and pressing Escape must
// forget it, or it keeps coming back.
const getContext = createQuickAddE2EHarness("prompt-draft-clear");

const INPUT = ".qaInputPrompt input";

async function openPromptValue(): Promise<string> {
	const { obsidian } = getContext();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`document.activeElement?.matches(${jsLiteral(INPUT)}) ?? false`,
	), POLL_OPTS).toBe(true);
	return obsidian.dev.evalJson<string>(`document.querySelector(${jsLiteral(INPUT)}).value`);
}

it("forgets a restored draft once the prompt is cleared and cancelled", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "# Inbox\n");

	const capture = new CaptureChoice("Draft clear inbox");
	capture.captureTo = inbox;
	capture.onePageInput = "never";
	capture.format = { enabled: true, format: "- {{VALUE}}" };

	await plugin.data<{ choices: IChoice[]; persistInputPromptDrafts?: boolean }>().patch((data) => {
		data.choices = [capture];
		data.persistInputPromptDrafts = true;
	});
	await plugin.reload({ waitUntilReady: true });

	const run = () => obsidian.dev.evalJson(
		`(() => { void app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(capture.name)}).catch(() => {}); return true; })()`,
	);
	const seen: string[] = [];

	// Type something and give up on it: it is kept as a draft.
	await run();
	seen.push(await openPromptValue());
	await typeInto(obsidian, INPUT, "half a thought");
	await pressKey(obsidian, "Escape");
	await expectNoPrompt(obsidian);

	// The draft comes back. Clear it the way a user does, then give up again.
	await run();
	seen.push(await openPromptValue());
	await obsidian.dev.evalJson(`(() => { const i = document.querySelector(${jsLiteral(INPUT)}); i.focus(); i.select(); return true; })()`);
	await pressKey(obsidian, "Backspace");
	await expect.poll(() => openPromptValue(), POLL_OPTS).toBe("");
	await pressKey(obsidian, "Escape");
	await expectNoPrompt(obsidian);

	// The cleared draft is gone.
	await run();
	seen.push(await openPromptValue());
	await pressKey(obsidian, "Escape");
	await expectNoPrompt(obsidian);

	expect(seen).toEqual(["", "half a thought", ""]);
	expect(await obsidian.dev.evalJsonAsync<string>(
		`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(inbox)}))`,
	)).toBe("# Inbox\n");
});
