import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, expectNoPrompt, pressKey, typeInto, waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// #1950: a {{VALUE:due}} in an included template reuses the including
// format's {{VDATE:due,...}}: one date prompt, printed in the VDATE's format.
const getContext = createQuickAddE2EHarness("include-date-reuse");

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
};

const PROMPT_INPUT = ".modal-container input";
const FIELD = ".onePageInputModal .setting-item";

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

async function runCapture(file: string, onePage: boolean) {
	const { obsidian, plugin, sandbox } = getContext();
	const include = await seedVaultFile(obsidian, sandbox, `due-${file}`, "(due {{VALUE:due}})");
	const choice = new CaptureChoice(`Log ${file}`);
	choice.command = true;
	choice.onePageInput = onePage ? "always" : "never";
	choice.captureTo = sandbox.path(file);
	choice.createFileIfItDoesntExist = { ...choice.createFileIfItDoesntExist, enabled: true };
	choice.format = {
		enabled: true,
		format: `- {{VALUE|label:What happened?}} 📅 {{VDATE:due,DD.MM.YYYY|label:When is it due?}}\n{{TEMPLATE:${include}}}`,
	};
	await plugin.data<QuickAddData>().patch(withStoredChoices((data) => {
		data.onePageInputEnabled = false;
		data.choices.push(choice);
	}));
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
}

async function promptTitle() {
	const { obsidian } = getContext();
	await waitForElement(obsidian, PROMPT_INPUT);
	return obsidian.dev.evalJson<string>(
		'document.querySelector(".modal-container .modal .modal-title")?.textContent ?? ""',
	);
}

describe("an included template's {{VALUE:due}} reuses the format's VDATE", () => {
	it("asks one date prompt step by step and writes the date in the VDATE's format", async () => {
		const { obsidian, sandbox } = getContext();
		await runCapture("step.md", false);

		// The include is formatted first, so the date is asked first.
		expect(await promptTitle()).toBe("When is it due?");
		await typeInto(obsidian, PROMPT_INPUT, "2026-10-02");
		await pressKey(obsidian, "Enter");
		await expect.poll(promptTitle, POLL_OPTS).toBe("What happened?");
		await typeInto(obsidian, PROMPT_INPUT, "Pay rent");
		await pressKey(obsidian, "Enter");
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("step.md").catch(() => ""), POLL_OPTS)
			.toBe("- Pay rent 📅 02.10.2026\n(due 02.10.2026)");
	});

	it("writes the one-page form's date in the VDATE's format inside the include", async () => {
		const { obsidian, sandbox } = getContext();
		await runCapture("form.md", true);

		await waitForElement(obsidian, FIELD);
		expect(await obsidian.dev.evalJson<string[]>(
			`Array.from(document.querySelectorAll(${JSON.stringify(FIELD)})).map((field) => field.querySelector(".setting-item-name")?.textContent ?? "")`,
		)).toEqual(["What happened?", "When is it due?"]);
		for (const [index, text] of ["Pay rent", "2026-10-02"].entries()) {
			expect(await obsidian.dev.evalJson<boolean>(`(() => {
				const input = document.querySelectorAll(${JSON.stringify(FIELD)})[${index}]?.querySelector("input, textarea");
				input?.focus();
				return Boolean(input);
			})()`)).toBe(true);
			await obsidian.exec("dev:cdp", {
				method: "Input.insertText",
				params: JSON.stringify({ text }),
			});
		}
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".modal-container button")].find((button) => button.textContent === "Submit")?.click();
			return true;
		})()`);
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("form.md").catch(() => ""), POLL_OPTS)
			.toBe("- Pay rent 📅 02.10.2026\n(due 02.10.2026)");
	});
});
