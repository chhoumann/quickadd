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

it("stops a macro whose Obsidian-command step runs its own registered command", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = await seedCounter(obsidian, sandbox);
	const macro = new MacroChoice("Command loop");
	macro.command = true;
	macro.macro.commands = [
		countStep(script),
		{ id: "self-command", name: "QuickAdd: Command loop", type: "Obsidian", commandId: `quickadd:choice:${macro.id}` } as ICommand,
	];
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [macro];
	});
	await plugin.reload({ waitUntilReady: true });

	await reset(obsidian);
	await obsidian.dev.evalJson(`(() => { app.commands.executeCommandById(${jsLiteral(`quickadd:choice:${macro.id}`)}); return true; })()`);
	await expect.poll(() => obsidian.dev.evalJson<string[]>(notices), POLL_OPTS).toEqual([
		'QuickAdd: (ERROR) Could not run "Command loop": Macro "Command loop" calls itself: Command loop -> Command loop',
	]);
	expect(await obsidian.dev.evalJson<number>(`window[${jsLiteral(COUNTER)}]`)).toBe(1);
});

it("runs two choices a script starts side by side, one running the other as a step", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const runsOfB = "__qaRunsOfB";
	const releaseB = "__qaReleaseB";
	// The run of B started by the script holds until A, which runs B as a step, is done.
	const bScript = await seedVaultFile(obsidian, sandbox, "side-b.js", `module.exports = async () => {
		window[${jsLiteral(runsOfB)}] = (window[${jsLiteral(runsOfB)}] ?? 0) + 1;
		if (window[${jsLiteral(runsOfB)}] === 1) await new Promise((resolve) => { window[${jsLiteral(releaseB)}] = resolve; });
	};`);
	const aScript = await seedVaultFile(obsidian, sandbox, "side-a.js", `module.exports = async () => {
		for (let i = 0; i < 200 && !window[${jsLiteral(releaseB)}]; i++) await new Promise((r) => setTimeout(r, 10));
	};`);
	const mScript = await seedVaultFile(obsidian, sandbox, "side-m.js", `module.exports = async ({ quickAddApi }) => {
		await Promise.all([
			quickAddApi.executeChoice("Side A").finally(() => window[${jsLiteral(releaseB)}]?.()),
			quickAddApi.executeChoice("Side B"),
		]);
	};`);
	const b = new MacroChoice("Side B");
	b.macro.commands = [{ id: "b", name: "b", type: "UserScript", path: bScript, settings: {} } as ICommand];
	const a = new MacroChoice("Side A");
	a.macro.commands = [{ id: "a", name: "a", type: "UserScript", path: aScript, settings: {} } as ICommand, runStep(b)];
	const m = new MacroChoice("Side by side");
	m.macro.commands = [{ id: "m", name: "m", type: "UserScript", path: mScript, settings: {} } as ICommand];
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [m, a, b];
	});
	await plugin.reload({ waitUntilReady: true });

	await reset(obsidian);
	await obsidian.dev.evalJson(`(() => { delete window[${jsLiteral(runsOfB)}]; delete window[${jsLiteral(releaseB)}]; return true; })()`);
	const run = await obsidian.execJson<{ ok: boolean; error?: string }>("quickadd:run", { id: m.id });
	expect(run).toMatchObject({ ok: true });
	expect(await obsidian.dev.evalJson<number>(`window[${jsLiteral(runsOfB)}]`)).toBe(2);
	expect(await obsidian.dev.evalJson<string[]>(notices)).toEqual([]);
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
