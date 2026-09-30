import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, expectNoPrompt, pressKey, waitForElement } from "./uiHelpers";

// #1996: Capture "One entry per line" writes the format once per line of
// {{VALUE}}, while macros and inline scripts run once per capture.
const getContext = createQuickAddE2EHarness("capture-each-line");

type QuickAddData = { choices: IChoice[]; onePageInputEnabled: boolean };

const NOTE = "# Launch\n\n## Tasks\n- [ ] Draft the press release\n";
const MACRO = "Each line counter";
// The macro and the inline script count their runs on window; both return a word.
const FORMAT = [
	"{{VALUE}} #{{VALUE:context}} {{MACRO:" + MACRO + "}} ",
	"```js quickadd\nwindow.qaEachLineScript = (window.qaEachLineScript ?? 0) + 1;\nreturn \"script\";\n```",
].join("");

async function closeOpenPrompts() {
	const { obsidian } = getContext();
	for (let remaining = 10; remaining > 0; remaining--) {
		if (!await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container, .prompt"))')) break;
		await pressKey(obsidian, "Escape");
	}
	await expectNoPrompt(obsidian);
}

beforeEach(async () => {
	await closeOpenPrompts();
	await getContext().obsidian.dev.evalJson("(() => { window.qaEachLineMacro = 0; window.qaEachLineScript = 0; return true; })()");
});
afterEach(closeOpenPrompts);

async function setUp(options: { eachLine: boolean; onePage?: boolean }) {
	const { obsidian, plugin, sandbox } = getContext();
	const script = await seedVaultFile(obsidian, sandbox, "counter.js",
		"module.exports = () => { window.qaEachLineMacro = (window.qaEachLineMacro ?? 0) + 1; return \"macro\"; };\n");
	const note = await seedVaultFile(obsidian, sandbox, "Launch.md", NOTE);
	const choice = new CaptureChoice("Each line E2E");
	choice.command = true;
	choice.captureTo = note;
	choice.task = true;
	choice.eachLine = options.eachLine;
	choice.onePageInput = options.onePage ? "always" : "never";
	choice.format = { enabled: true, format: FORMAT };
	choice.insertAfter = { ...choice.insertAfter, enabled: true, after: "## Tasks", insertAtEnd: true };
	const macro = {
		id: `${choice.id}-macro`, name: MACRO, type: "Macro", command: false, runOnStartup: false,
		macro: { id: `${choice.id}-macro`, name: MACRO, commands: [{ id: `${choice.id}-script`, name: "Counter", type: "UserScript", path: script, settings: {} }] },
	} as unknown as IChoice;
	await plugin.data<QuickAddData>().patch((data) => {
		data.onePageInputEnabled = false;
		data.choices.push(choice, macro);
	});
	await plugin.reload({ waitUntilReady: true });
	return { choice, note };
}

const runs = () => getContext().obsidian.dev.evalJson<{ macro: number; script: number }>(
	"({ macro: window.qaEachLineMacro, script: window.qaEachLineScript })",
);

async function typeInto(selector: string, text: string) {
	const { obsidian } = getContext();
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const input = document.querySelector(${JSON.stringify(selector)});
		input?.focus();
		return Boolean(input);
	})()`)).toBe(true);
	await obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text }) });
}

async function click(label: string) {
	await getContext().obsidian.dev.evalJson(`(() => {
		[...document.querySelectorAll(".modal-container button")].find((button) => button.textContent === ${JSON.stringify(label)})?.click();
		return true;
	})()`);
}

const expected = (lines: string[]) => NOTE.replace(
	"- [ ] Draft the press release\n",
	"- [ ] Draft the press release\n" + lines.map((line) => `- [ ] ${line} #home macro script\n`).join(""),
);

describe("Capture: one entry per line", () => {
	it("writes one task per line from the CLI, running the macro and inline script once", async () => {
		const { obsidian, sandbox } = getContext();
		const { choice } = await setUp({ eachLine: true });

		const outcome = await obsidian.execJson("quickadd:run", {
			id: choice.id, verify: true,
			vars: JSON.stringify({ value: "Book the venue\n\n  Send the invites  \r\nOrder the cake", context: "home" }),
		});

		expect(outcome).toMatchObject({ ok: true, verified: true, effect: "changed" });
		await expect.poll(() => sandbox.read("Launch.md"), POLL_OPTS)
			.toBe(expected(["Book the venue", "Send the invites", "Order the cake"]));
		expect(await runs()).toEqual({ macro: 1, script: 1 });
	});

	it("asks for the value in a multi-line box and splits what you type", async () => {
		const { obsidian, sandbox } = getContext();
		const { choice } = await setUp({ eachLine: true });
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		await waitForElement(obsidian, ".modal-container textarea");
		await typeInto(".modal-container textarea", "Book the venue\nSend the invites");
		await click("Ok");
		await waitForElement(obsidian, ".modal-container input");
		await typeInto(".modal-container input", "home");
		await click("Ok");

		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("Launch.md"), POLL_OPTS).toBe(expected(["Book the venue", "Send the invites"]));
		expect(await runs()).toEqual({ macro: 1, script: 1 });
	});

	it("offers a text area for the value in the one-page form", async () => {
		const { obsidian, sandbox } = getContext();
		const { choice } = await setUp({ eachLine: true, onePage: true });
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		const field = ".modal-container .setting-item";
		await waitForElement(obsidian, field);
		expect(await obsidian.dev.evalJson<string[]>(
			`Array.from(document.querySelectorAll(${JSON.stringify(field)})).map((f) => f.querySelector("textarea") ? "textarea" : "input")`,
		)).toEqual(["textarea", "input"]);
		await typeInto(".modal-container .setting-item textarea", "Book the venue\nOrder the cake");
		await typeInto(".modal-container .setting-item input", "home");
		await click("Submit");

		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("Launch.md"), POLL_OPTS).toBe(expected(["Book the venue", "Order the cake"]));
		expect(await runs()).toEqual({ macro: 1, script: 1 });
	});

	it("keeps a multi-line value as one entry when the option is off", async () => {
		const { obsidian, sandbox } = getContext();
		const { choice } = await setUp({ eachLine: false });

		const outcome = await obsidian.execJson("quickadd:run", {
			id: choice.id, verify: true, vars: JSON.stringify({ value: "Book the venue\nOrder the cake", context: "home" }),
		});

		expect(outcome).toMatchObject({ ok: true });
		await expect.poll(() => sandbox.read("Launch.md"), POLL_OPTS)
			.toBe(NOTE.replace("- [ ] Draft the press release\n", "- [ ] Draft the press release\n- [ ] Book the venue\nOrder the cake #home macro script\n"));
		expect(await runs()).toEqual({ macro: 1, script: 1 });
	});
});
