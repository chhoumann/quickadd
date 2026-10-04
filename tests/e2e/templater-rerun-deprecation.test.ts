import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { ObsidianCommand } from "../../src/types/macros/ObsidianCommand";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";
import { WaitCommand } from "../../src/types/macros/QuickCommands/WaitCommand";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";

// #2014: re-running Templater after QuickAdd wrote a note is deprecated. Each
// pattern shows a notice the first time it runs in a session, not on every run.
const getContext = createQuickAddE2EHarness("templater-rerun-deprecation");

async function watchNotices() {
	await getContext().obsidian.dev.evalJson(`(() => {
		window.__qaNotices = [];
		window.__qaNoticeObserver?.disconnect();
		window.__qaNoticeObserver = new MutationObserver(records => {
			for (const record of records) for (const node of record.addedNodes) {
				if (node instanceof HTMLElement && node.matches(".notice")) window.__qaNotices.push(node.textContent);
			}
		});
		window.__qaNoticeObserver.observe(document.body, { childList: true, subtree: true });
		return true;
	})()`);
}

const noticesContaining = (text: string) => getContext().obsidian.dev.evalJson<number>(
	`window.__qaNotices.filter(n => n.includes(${JSON.stringify(text)})).length`,
);

async function saveChoices(choices: IChoice[]) {
	const { plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = choices;
	}));
	await plugin.reload({ waitUntilReady: true });
}

it("warns once when a macro runs Replace templates after a Template step", async () => {
	const { obsidian, sandbox } = getContext();
	const template = new TemplateChoice("Rerun note");
	template.templatePath = await seedVaultFile(obsidian, sandbox, "Rerun template.md", "body\n");
	template.fileNameFormat = { enabled: true, format: `${sandbox.path("Rerun")}` };
	template.fileExistsBehavior = { kind: "apply", mode: "increment" };
	const macro = new MacroChoice("Rerun macro");
	macro.macro.commands = [
		new NestedChoiceCommand(template),
		new WaitCommand(10),
		new ObsidianCommand("Templater: Replace templates in the active file", "templater-obsidian:replace-in-file-templater"),
	];
	await saveChoices([macro]);
	await watchNotices();

	await obsidian.exec("quickadd:run", { choice: macro.name });
	await obsidian.exec("quickadd:run", { choice: macro.name });

	await expect.poll(() => sandbox.read("Rerun.md").then(() => true, () => false)).toBe(true);
	expect(await noticesContaining("runs \"Templater: Replace templates in the active file\" after 'Rerun note'")).toBe(1);
});

it("warns once when a Capture runs Templater on the whole file", async () => {
	const { obsidian, sandbox } = getContext();
	const capture = new CaptureChoice("Whole file capture");
	capture.captureTo = await seedVaultFile(obsidian, sandbox, "Whole.md", "");
	capture.prepend = true;
	capture.templater = { afterCapture: "wholeFile" };
	const other = new CaptureChoice("Plain capture");
	other.captureTo = capture.captureTo;
	other.prepend = true;
	await saveChoices([capture, other]);
	await watchNotices();

	for (const name of [capture.name, capture.name, other.name]) {
		await obsidian.exec("quickadd:run", { choice: name, "value-value": name });
	}

	await expect.poll(() => sandbox.read("Whole.md")).toContain("Plain capture");
	expect(await noticesContaining("Run Templater on entire destination file after capture")).toBe(1);
});
