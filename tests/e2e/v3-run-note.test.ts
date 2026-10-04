import { afterEach, beforeEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";
import { OpenFileCommand } from "../../src/types/macros/QuickCommands/OpenFileCommand";
import { UserScript } from "../../src/types/macros/UserScript";
import type { Action, ActionNode } from "../../src/v3/model";
import { RUN_NOTE } from "../../src/v3/model";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { POLL_OPTS } from "./uiHelpers";

// {{NOTE}} is the note the run last created or wrote to: a later step opens it,
// writes to it again, or hands it to a script as params.note.
const getContext = createQuickAddE2EHarness("v3-run-note");

type Data = { choices: IChoice[]; actions: ActionNode[] };

const READS_NOTE = "module.exports = (params) => { window.__qaNote = params.note?.path ?? null; };";

beforeEach(async () => {
	await getContext().obsidian.dev.evalJson("(() => { delete window.__qaNote; return true; })()");
});

afterEach(async () => {
	await getContext().obsidian.dev.evalJson("(() => { delete window.__qaNote; return true; })()");
});

function capture(name: string, captureTo: string, format: string): CaptureChoice {
	const choice = new CaptureChoice(name);
	choice.captureTo = captureTo;
	choice.prepend = true;
	choice.format = { enabled: true, format };
	return choice;
}

async function store(macro: MacroChoice) {
	const { plugin } = getContext();
	macro.onePageInput = "never";
	// Patching first also has the harness put data.json back after the test.
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [macro];
	}));
	await plugin.reload({ waitUntilReady: true });
}

it("hands the note a nested capture created to a script and opens it", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = await seedVaultFile(obsidian, sandbox, "scripts/reads-note.js", READS_NOTE);
	const note = sandbox.path("notes/run-note.md");
	const write = capture("Write", note, "- {{VALUE}}");
	write.createFileIfItDoesntExist = { enabled: true, createWithTemplate: false, template: "" };
	const macro = new MacroChoice("Write then open");
	macro.macro.commands.push(
		new NestedChoiceCommand(write),
		new UserScript("reads note", script),
		new OpenFileCommand(RUN_NOTE),
	);
	await store(macro);

	const action = (await plugin.data<Data>().read()).actions.find((node): node is Action => node.id === macro.id);
	expect(action?.steps.map((step) => step.type)).toEqual(["addToNote", "runScript", "open"]);
	expect(action?.steps[2]).toMatchObject({ note: RUN_NOTE });

	expect(await obsidian.execJson("quickadd:run", { id: macro.id, verify: true, vars: JSON.stringify({ value: "first" }) }))
		.toMatchObject({ ok: true });
	await expect.poll(() => sandbox.read("notes/run-note.md"), POLL_OPTS).toBe("- first");
	expect(await obsidian.dev.evalJson<string | null>("window.__qaNote ?? null")).toBe(note);
	await expect.poll(() => obsidian.dev.evalJson<string | null>("app.workspace.getActiveFile()?.path ?? null"), POLL_OPTS)
		.toBe(note);
});

it("writes a second capture into the note the first one wrote to", async () => {
	const { obsidian, sandbox } = getContext();
	const log = await seedVaultFile(obsidian, sandbox, "log.md", "# Log\n");
	const macro = new MacroChoice("Write twice");
	macro.macro.commands.push(
		new NestedChoiceCommand(capture("First", log, "- {{VALUE}}")),
		new NestedChoiceCommand(capture("Second", RUN_NOTE, "- second")),
	);
	await store(macro);

	expect(await obsidian.execJson("quickadd:run", { id: macro.id, verify: true, vars: JSON.stringify({ value: "first" }) }))
		.toMatchObject({ ok: true });
	await expect.poll(() => sandbox.read("log.md"), POLL_OPTS).toBe("# Log\n- first\n- second");
});
