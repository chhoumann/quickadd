import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { expectNoPrompt, jsLiteral, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// A cancelled run keeps the date a prompt submitted, stored as `@date:<ISO>`.
// Reopened, the prompt must show that date, not the stored value (#1929).
const getContext = createQuickAddE2EHarness("date-prompt-draft");

const DATE_INPUT = ".qaDatePrompt input.qa-vdate-input";
const TEXT_INPUT = ".qaInputPrompt input";

async function focusedValue(selector: string): Promise<string> {
	const { obsidian } = getContext();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`document.activeElement?.matches(${jsLiteral(selector)}) ?? false`,
	), POLL_OPTS).toBe(true);
	return obsidian.dev.evalJson<string>(`document.querySelector(${jsLiteral(selector)}).value`);
}

it("reopens a date answered in a cancelled run as the date, and captures that date", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "# Inbox\n");

	const capture = new CaptureChoice("Date draft inbox");
	capture.captureTo = inbox;
	capture.onePageInput = "never";
	capture.prepend = true;
	capture.format = { enabled: true, format: "- {{VDATE:due,YYYY-MM-DD}} {{VALUE:what}}" };

	await plugin.data<{ choices: IChoice[]; persistInputPromptDrafts?: boolean }>().patch((data) => {
		data.choices = [capture];
		data.persistInputPromptDrafts = true;
	});
	await plugin.reload({ waitUntilReady: true });

	const run = () => obsidian.dev.evalJson(
		`(() => { void app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(capture.name)}).catch(() => {}); return true; })()`,
	);

	await run();
	expect(await focusedValue(DATE_INPUT)).toBe("");
	await typeInto(obsidian, DATE_INPUT, "2026-10-02");
	await pressKey(obsidian, "Enter");
	await focusedValue(TEXT_INPUT);
	await pressKey(obsidian, "Escape");
	await expectNoPrompt(obsidian);

	// Like any restored draft, it opens selected, so typing replaces it.
	await run();
	expect(await focusedValue(DATE_INPUT)).toBe("2026-10-02");
	expect(await obsidian.dev.evalJson<number[]>(`(() => {
		const input = document.querySelector(${jsLiteral(DATE_INPUT)});
		return [input.selectionStart, input.selectionEnd];
	})()`)).toEqual([0, "2026-10-02".length]);
	await pressKey(obsidian, "Enter");
	await typeInto(obsidian, TEXT_INPUT, "glaze fire");
	await pressKey(obsidian, "Enter");

	await expect.poll(() => obsidian.dev.evalJsonAsync<string>(
		`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(inbox)}))`,
	), POLL_OPTS).toBe("# Inbox\n- 2026-10-02 glaze fire");
});
