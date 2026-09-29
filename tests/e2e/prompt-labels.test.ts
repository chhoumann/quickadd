import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, expectNoPrompt, pressKey, typeInto, waitForElement } from "./uiHelpers";

// `|label:` names the prompt of a {{VDATE}} (#1869), an unnamed {{VALUE}}
// (#1876) and a named single-value {{VALUE}}, in place of the variable name.
const getContext = createQuickAddE2EHarness("prompt-labels");

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
};

const PROMPT_INPUT = ".modal-container input";

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

/** The open prompt's title and input, and how often the label text appears in it. */
async function readPrompt(label: string) {
	const { obsidian } = getContext();
	await waitForElement(obsidian, PROMPT_INPUT);
	return obsidian.dev.evalJson<{ title: string; value: string; labelCount: number }>(`(() => {
		const modal = document.querySelector(".modal-container .modal");
		const text = modal?.innerText ?? "";
		return {
			title: modal?.querySelector(".modal-title")?.textContent ?? "",
			value: modal?.querySelector("input")?.value ?? "",
			labelCount: text.split(${JSON.stringify(label)}).length - 1,
		};
	})()`);
}

/** Run a new Capture choice that writes `format` to `file`. */
async function runCapture(file: string, format: string, onePage: boolean) {
	const { obsidian, plugin, sandbox } = getContext();
	const choice = new CaptureChoice(`Log ${file}`);
	choice.command = true;
	choice.captureTo = sandbox.path(file);
	choice.createFileIfItDoesntExist = { ...choice.createFileIfItDoesntExist, enabled: true };
	choice.format = { enabled: true, format };
	await plugin.data<QuickAddData>().patch((data) => {
		data.onePageInputEnabled = onePage;
		data.choices.push(choice);
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
}

describe("|label: names the prompt", () => {
	it("titles a VDATE prompt, and is never read as the default date (#1869)", async () => {
		const { obsidian } = getContext();
		await obsidian.dev.evalJson(`(() => {
			window.__qaVDateLabel = undefined;
			app.plugins.plugins.quickadd.api
				.format("{{VDATE:due,YYYY-MM-DD|label:Due}}")
				.then((value) => { window.__qaVDateLabel = value; }, (error) => { window.__qaVDateLabel = "error: " + error.message; });
			return true;
		})()`);

		expect(await readPrompt("Due")).toEqual({ title: "Due", value: "", labelCount: 1 });
		await typeInto(obsidian, PROMPT_INPUT, "2026-10-02");
		await pressKey(obsidian, "Enter");
		await expect.poll(
			() => obsidian.dev.evalJson<string | null>("window.__qaVDateLabel ?? null"),
			POLL_OPTS,
		).toBe("2026-10-02");
	});

	it("titles an unnamed VALUE prompt instead of showing as helper text (#1876)", async () => {
		const { obsidian, sandbox } = getContext();
		await runCapture("orders.md", "### {{VALUE|label:What's the order?}}\n", false);

		expect(await readPrompt("What's the order?")).toMatchObject({
			title: "What's the order?",
			labelCount: 1,
		});
		await typeInto(obsidian, PROMPT_INPUT, "48 speckled sage mugs");
		await pressKey(obsidian, "Enter");
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("orders.md").catch(() => ""), POLL_OPTS)
			.toBe("### 48 speckled sage mugs\n");
	});

	it("titles a named VALUE prompt, where it used to be helper text under the name", async () => {
		const { obsidian, sandbox } = getContext();
		await runCapture("meeting prompt.md", "- attendees: {{VALUE:attendees|label:Who attended?}}\n", false);

		const prompt = await readPrompt("Who attended?");
		expect(prompt).toMatchObject({ title: "Who attended?", labelCount: 1 });
		await typeInto(obsidian, PROMPT_INPUT, "Ada, Grace");
		await pressKey(obsidian, "Enter");
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("meeting prompt.md").catch(() => ""), POLL_OPTS)
			.toBe("- attendees: Ada, Grace\n");
	});

	it("names a named VALUE's one-page field, with no helper text", async () => {
		const { obsidian, sandbox } = getContext();
		await runCapture("meeting form.md", "- attendees: {{VALUE:attendees|label:Who attended?}}\n", true);

		await waitForElement(obsidian, ".onePageInputModal");
		expect(await obsidian.dev.evalJson<{ name: string; description: string }[]>(
			'Array.from(document.querySelectorAll(".onePageInputModal .setting-item")).filter((row) => row.querySelector("input")).map((row) => ({ name: row.querySelector(".setting-item-name")?.textContent ?? "", description: row.querySelector(".setting-item-description")?.textContent ?? "" }))',
		)).toEqual([{ name: "Who attended?", description: "" }]);
		await typeInto(obsidian, '.onePageInputModal input[aria-labelledby="qa-onepage-label-attendees"]', "Ada, Grace");
		await pressKey(obsidian, "Enter", true);
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("meeting form.md").catch(() => ""), POLL_OPTS)
			.toBe("- attendees: Ada, Grace\n");
	});
});
