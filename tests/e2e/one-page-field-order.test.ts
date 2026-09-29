import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, expectNoPrompt, pressKey, waitForElement } from "./uiHelpers";

// #1876: the one-page form lists fields in the order the format reads, not
// dates first and the capture text last.
const getContext = createQuickAddE2EHarness("one-page-field-order");

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
};

const FIELD = ".modal-container .setting-item";

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

describe("one-page form field order", () => {
	it("follows the Capture format, and the run writes the same note", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const choice = new CaptureChoice("Log order");
		choice.command = true;
		choice.onePageInput = "always";
		choice.captureTo = sandbox.path("orders.md");
		choice.createFileIfItDoesntExist = { ...choice.createFileIfItDoesntExist, enabled: true };
		choice.format = {
			enabled: true,
			format: "### {{VALUE}} for {{VALUE:client}}\n- [ ] Deliver 📅 {{VDATE:due,YYYY-MM-DD}}\n- [ ] Invoice 📅 {{VALUE:due}}\n",
		};
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = false;
			data.choices.push(choice);
		});
		await plugin.reload({ waitUntilReady: true });
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		await waitForElement(obsidian, FIELD);
		expect(await obsidian.dev.evalJson<string[]>(
			`Array.from(document.querySelectorAll(${JSON.stringify(FIELD)})).map((field) => field.querySelector(".setting-item-name")?.textContent ?? "")`,
		)).toEqual(["Enter value", "client", "due"]);

		for (const [index, text] of ["48 mugs", "Northwind", "2026-10-02"].entries()) {
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
		await expect.poll(() => sandbox.read("orders.md").catch(() => ""), POLL_OPTS)
			.toBe("### 48 mugs for Northwind\n- [ ] Deliver 📅 2026-10-02\n- [ ] Invoice 📅 2026-10-02\n");
	});
});
