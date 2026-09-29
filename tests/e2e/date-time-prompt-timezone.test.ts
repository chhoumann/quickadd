import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { expectNoPrompt, jsLiteral, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// A typed date is stored as a UTC instant. Outside UTC, the time control must
// still show the local time, and a day pick must keep it (#1946).
const getContext = createQuickAddE2EHarness("date-time-prompt-timezone");

const DATE_INPUT = ".qaDatePrompt input.qa-vdate-input";
const TIME_INPUT = ".qaDatePrompt input.qa-date-picker__time-input";
const TEXT_INPUT = ".qaInputPrompt input";

async function setTimezone(timezoneId: string) {
	const reply = await getContext().obsidian.execText("dev:cdp", {
		method: "Emulation.setTimezoneOverride",
		params: JSON.stringify({ timezoneId }),
	});
	if (!reply.startsWith("{")) throw new Error(`dev:cdp setTimezoneOverride failed: ${reply}`);
}

async function focused(selector: string) {
	await expect.poll(() => getContext().obsidian.dev.evalJson<boolean>(
		`document.activeElement?.matches(${jsLiteral(selector)}) ?? false`,
	), POLL_OPTS).toBe(true);
}

const timeControl = () => getContext().obsidian.dev.evalJson<string>(
	`document.querySelector(${jsLiteral(TIME_INPUT)})?.value ?? ""`,
);

const clickDay = (label: string) => getContext().obsidian.dev.evalJson<boolean>(`(() => {
	const day = [...document.querySelectorAll(".qaDatePrompt button.qa-date-picker__day")]
		.find((button) => button.getAttribute("aria-label") === ${jsLiteral(label)});
	day?.click();
	return Boolean(day);
})()`);

it("shows a typed or restored time in local time and keeps it when a day is picked", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "# Inbox\n");

	const capture = new CaptureChoice("Time zone inbox");
	capture.captureTo = inbox;
	capture.onePageInput = "never";
	capture.prepend = true;
	capture.format = { enabled: true, format: "- {{VDATE:when,YYYY-MM-DD HH:mm|time}} {{VALUE:what}}" };

	await plugin.data<{ choices: IChoice[]; persistInputPromptDrafts?: boolean }>().patch((data) => {
		data.choices = [capture];
		data.persistInputPromptDrafts = true;
	});
	await plugin.reload({ waitUntilReady: true });

	const run = () => obsidian.dev.evalJson(
		`(() => { void app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(capture.name)}).catch(() => {}); return true; })()`,
	);

	await setTimezone("Europe/Copenhagen"); // UTC+2 in September
	try {
		// Typed: stored as 13:00Z, which is 15:00 here.
		await run();
		await focused(DATE_INPUT);
		await typeInto(obsidian, DATE_INPUT, "2026-09-30 15:00");
		await expect.poll(timeControl, POLL_OPTS).toBe("15:00");
		await pressKey(obsidian, "Enter");
		await focused(TEXT_INPUT);
		// Cancel, so the answer is kept as a draft.
		await pressKey(obsidian, "Escape");
		await expectNoPrompt(obsidian);

		// Restored draft, then a day pick: the time stays 15:00.
		await run();
		await focused(DATE_INPUT);
		expect(await timeControl()).toBe("15:00");
		expect(await clickDay("Friday, October 2, 2026")).toBe(true);
		expect(await obsidian.dev.evalJson<string>(`document.querySelector(${jsLiteral(DATE_INPUT)}).value`))
			.toBe("2026-10-02 15:00");
		await obsidian.dev.evalJson(`(() => { document.querySelector(${jsLiteral(DATE_INPUT)}).focus(); return true; })()`);
		await pressKey(obsidian, "Enter");
		await typeInto(obsidian, TEXT_INPUT, "glaze fire");
		await pressKey(obsidian, "Enter");

		await expect.poll(() => obsidian.dev.evalJsonAsync<string>(
			`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(inbox)}))`,
		), POLL_OPTS).toBe("# Inbox\n- 2026-10-02 15:00 glaze fire");
	} finally {
		await setTimezone("");
	}
});
