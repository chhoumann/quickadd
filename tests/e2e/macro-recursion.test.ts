import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { ICommand } from "../../src/types/macros/ICommand";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, POLL_OPTS } from "./uiHelpers";

// A macro that reaches itself stops with an error naming the cycle instead of
// recursing until Obsidian is killed.
const getContext = createQuickAddE2EHarness("macro-recursion");

const COUNTER = "__qaRecursionCount";
const notices = `Array.from(document.querySelectorAll(".notice"), (n) => n.textContent)`;

async function seedCounter(obsidian: Parameters<typeof seedVaultFile>[0], sandbox: Parameters<typeof seedVaultFile>[1]) {
	// Throws after a few runs so a missing guard fails the spec instead of hanging it.
	return seedVaultFile(obsidian, sandbox, "count.js", `module.exports = () => {
		window[${jsLiteral(COUNTER)}] = (window[${jsLiteral(COUNTER)}] ?? 0) + 1;
		if (window[${jsLiteral(COUNTER)}] > 20) throw new Error("runaway recursion");
	};`);
}

function countStep(path: string): ICommand {
	return { id: "count", name: "count", type: "UserScript", path, settings: {} } as ICommand;
}

function runStep(choice: IChoice): ICommand {
	return { id: `run-${choice.id}`, name: choice.name, type: "Choice", choiceId: choice.id } as ICommand;
}

async function reset(obsidian: Parameters<typeof seedVaultFile>[0]) {
	await obsidian.dev.evalJson(`(() => {
		window[${jsLiteral(COUNTER)}] = 0;
		document.querySelectorAll(".notice").forEach((n) => n.remove());
		return true;
	})()`);
}

it("stops a macro whose Choice step runs itself, from its command and from the CLI", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = await seedCounter(obsidian, sandbox);
	const macro = new MacroChoice("Self loop");
	macro.command = true;
	macro.macro.commands = [countStep(script), runStep(macro)];
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [macro];
	});
	await plugin.reload({ waitUntilReady: true });
	const cycle = 'Macro "Self loop" calls itself: Self loop -> Self loop';

	await reset(obsidian);
	await obsidian.dev.evalJson(`(() => { app.commands.executeCommandById(${jsLiteral(`quickadd:choice:${macro.id}`)}); return true; })()`);
	await expect.poll(() => obsidian.dev.evalJson<string[]>(notices), POLL_OPTS).toEqual([
		`QuickAdd: (ERROR) Could not run "Self loop": ${cycle}`,
	]);
	expect(await obsidian.dev.evalJson<number>(`window[${jsLiteral(COUNTER)}]`)).toBe(1);

	await reset(obsidian);
	const run = await obsidian.execJson<{ ok: boolean; error?: string }>("quickadd:run", { id: macro.id });
	expect(run).toMatchObject({ ok: false, error: cycle });
	expect(await obsidian.dev.evalJson<number>(`window[${jsLiteral(COUNTER)}]`)).toBe(1);
});

it("stops a capture whose {{MACRO:}} runs the capture again", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = await seedCounter(obsidian, sandbox);
	const capture = new CaptureChoice("Loop capture");
	capture.captureTo = sandbox.path("loop-capture.md");
	capture.createFileIfItDoesntExist = { enabled: true, createWithTemplate: false, template: "" };
	capture.format = { enabled: true, format: "{{MACRO:Loop macro}}" };
	const macro = new MacroChoice("Loop macro");
	macro.macro.commands = [countStep(script), runStep(capture)];
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [capture, macro];
	});
	await plugin.reload({ waitUntilReady: true });

	await reset(obsidian);
	const run = await obsidian.execJson<{ ok: boolean; error?: string }>("quickadd:run", { id: capture.id, verify: "true" });
	const cycle = 'Capture "Loop capture" calls itself: Loop capture -> Loop macro -> Loop capture';
	expect(run).toMatchObject({ ok: false, error: cycle });
	expect(await obsidian.dev.evalJson<string[]>(notices)).toEqual([
		`QuickAdd: (ERROR) Error running capture choice "Loop capture": ${cycle}`,
	]);
	expect(await obsidian.dev.evalJson<number>(`window[${jsLiteral(COUNTER)}]`)).toBe(1);
	expect(await sandbox.read("loop-capture.md").catch(() => null)).toBeNull();
});

it("still runs a macro that runs another macro twice", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = await seedCounter(obsidian, sandbox);
	const inner = new MacroChoice("Inner");
	inner.macro.commands = [countStep(script)];
	const outer = new MacroChoice("Outer");
	outer.macro.commands = [runStep(inner), runStep(inner)];
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [outer, inner];
	});
	await plugin.reload({ waitUntilReady: true });

	await reset(obsidian);
	const run = await obsidian.execJson<{ ok: boolean }>("quickadd:run", { id: outer.id });
	expect(run).toMatchObject({ ok: true });
	expect(await obsidian.dev.evalJson<number>(`window[${jsLiteral(COUNTER)}]`)).toBe(2);
});
