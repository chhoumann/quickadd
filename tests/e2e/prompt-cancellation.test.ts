import { expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { ChoiceCommand } from "../../src/types/macros/ChoiceCommand";
import { ConditionalCommand } from "../../src/types/macros/Conditional/ConditionalCommand";
import { UserScript } from "../../src/types/macros/UserScript";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { insertText, jsLiteral, POLL_OPTS, pressKey } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// Pressing Escape in a prompt is a normal way to stop a run. It must not land in
// Obsidian's `dev:errors`, which records every unhandled promise rejection (even one
// a listener claimed with preventDefault). Real failures must still land there.
const getContext = createQuickAddE2EHarness("prompt-cancellation");

const NO_ERRORS = "No errors captured.";
const PROMPT = ".modal-container, .prompt";

type Entry = "command" | "launcher" | "cli" | "uri" | "api" | "api-floated";

async function devErrors(obsidian: ObsidianClient): Promise<string> {
	return (await obsidian.execText("dev:errors")).trim();
}

async function clearDevErrors(obsidian: ObsidianClient) {
	await obsidian.exec("dev:errors", { clear: true });
}

async function promptOpen(obsidian: ObsidianClient): Promise<boolean> {
	return obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${jsLiteral(PROMPT)}))`);
}

/** Escape only reaches a prompt once it has focus; pressing earlier is a no-op. */
async function waitForFocusedPrompt(obsidian: ObsidianClient) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`Boolean(document.activeElement?.closest(${jsLiteral(PROMPT)}))`,
	), POLL_OPTS).toBe(true);
}

/** Press Escape until no prompt is left; a cancelled run must not open another one. */
async function escapeUntilClosed(obsidian: ObsidianClient): Promise<number> {
	let presses = 0;
	while (presses < 4 && await promptOpen(obsidian)) {
		await pressKey(obsidian, "Escape");
		presses++;
		await obsidian.sleep(300);
	}
	return presses;
}

async function seedChoices() {
	const { obsidian, plugin, sandbox } = getContext();
	const note = await seedVaultFile(obsidian, sandbox, "Note.md", "# Note\n\nbody\n");
	await seedVaultFile(obsidian, sandbox, "Attachments/pic.png", "png");
	await seedVaultFile(obsidian, sandbox, "Tagged.md", "---\nstatus: open\n---\n");
	const template = await seedVaultFile(obsidian, sandbox, "Templates/T.md", "templated\n");
	const askScript = await seedVaultFile(
		obsidian, sandbox, "Scripts/ask.js",
		"module.exports = async (params) => { await params.quickAddApi.inputPrompt('Script prompt'); };",
	);

	const capture = (name: string, format: string) => {
		const choice = new CaptureChoice(name);
		choice.command = true;
		choice.captureToActiveFile = true;
		choice.onePageInput = "never";
		choice.format = { enabled: true, format };
		return choice;
	};

	// The reported case: a FILE picker in a Capture to the active file.
	const file = capture("Cancel file capture", `!{{FILE:${sandbox.path("Attachments")}|type:image|link}}`);
	const value = capture("Cancel value capture", "{{VALUE}}");
	const field = capture("Cancel field capture", "{{FIELD:status}}");
	const onePage = capture("Cancel one page capture", "{{VALUE:alpha}} {{VALUE:beta}}");
	onePage.onePageInput = "always";

	const templateChoice = new TemplateChoice("Cancel template choice");
	templateChoice.command = true;
	templateChoice.onePageInput = "never";
	templateChoice.templatePath = template;
	templateChoice.folder = { ...templateChoice.folder, enabled: true, folders: [sandbox.path("Out")] };

	const macroScript = new MacroChoice("Cancel macro script");
	macroScript.command = true;
	macroScript.onePageInput = "never";
	macroScript.macro.commands.push(new UserScript("ask", askScript));

	const captureForMacro = capture("Cancel value capture for macro", "{{VALUE}}");
	const macroChoice = new MacroChoice("Cancel macro choice");
	macroChoice.command = true;
	macroChoice.onePageInput = "never";
	macroChoice.macro.commands.push(new ChoiceCommand(captureForMacro.name, captureForMacro.id));

	const multi = new MultiChoice("Cancel multi").addChoice(capture("Cancel value capture in multi", "{{VALUE}}"));
	multi.command = true;

	const targets = { file, value, field, onePage, template: templateChoice, macroScript, macroChoice, multi };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [...Object.values(targets), captureForMacro];
	}));
	await plugin.reload({ waitUntilReady: true });
	return { note, targets };
}

async function openNote(obsidian: ObsidianClient, path: string) {
	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(path)}), { state: { mode: "source" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	})()`);
}

/** Start `choice` the way a user (or a script) would; resolves once it is running. */
async function start(
	obsidian: ObsidianClient,
	entry: Entry,
	choice: IChoice,
): Promise<{ cliResult?: Promise<string> }> {
	const name = jsLiteral(choice.name);
	switch (entry) {
		case "command":
			await obsidian.command(`quickadd:choice:${choice.id}`).run();
			return {};
		case "launcher":
			await obsidian.command("quickadd:runQuickAdd").run();
			await waitForFocusedPrompt(obsidian);
			await insertText(obsidian, choice.name);
			await obsidian.sleep(200);
			await pressKey(obsidian, "Enter");
			await obsidian.sleep(400);
			return {};
		case "cli":
			// Settles only once the run ends, so it is awaited after Escape.
			return { cliResult: obsidian.execText("quickadd:run", { id: choice.id, ui: true }) };
		case "uri":
			await obsidian.dev.evalJson(`(() => {
				void app.workspace.protocolHandler.handlers.get("quickadd")({ action: "quickadd", choice: ${name} });
				return true;
			})()`);
			return {};
		case "api":
			await obsidian.dev.evalJson(`(() => {
				window.__qaCancel = { status: "pending" };
				app.plugins.plugins.quickadd.api.executeChoice(${name}).then(
					() => { window.__qaCancel = { status: "resolved" }; },
					(error) => { window.__qaCancel = { status: "rejected", name: error?.name }; },
				);
				return true;
			})()`);
			return {};
		case "api-floated":
			// A button in a note that runs a choice and never catches the promise.
			await obsidian.dev.evalJson(`(() => { void app.plugins.plugins.quickadd.api.executeChoice(${name}); return true; })()`);
			return {};
	}
}

async function outcome(obsidian: ObsidianClient, entry: Entry, cliResult?: Promise<string>) {
	if (entry === "cli") {
		const { ok, aborted } = JSON.parse(await cliResult!) as { ok: boolean; aborted?: boolean };
		return { ok, aborted };
	}
	if (entry === "api") {
		await expect.poll(() => obsidian.dev.evalJson<{ status: string }>("window.__qaCancel"), POLL_OPTS)
			.not.toMatchObject({ status: "pending" });
		return obsidian.dev.evalJson("window.__qaCancel");
	}
	return null;
}

const EXPECTED_OUTCOME: Record<Entry, unknown> = {
	command: null,
	launcher: null,
	// The CLI and awaiting scripts still learn the run was cancelled.
	cli: { ok: false, aborted: true },
	uri: null,
	api: { status: "rejected", name: "MacroAbortError" },
	"api-floated": null,
};

it.each(Object.keys(EXPECTED_OUTCOME) as Entry[])(
	"one Escape stops every prompt kind started via %s without a dev:errors entry",
	async (entry) => {
		const { obsidian } = getContext();
		const { note, targets } = await seedChoices();
		const results: Record<string, unknown> = {};
		const expected: Record<string, unknown> = {};

		for (const [kind, choice] of Object.entries(targets)) {
			// The CLI refuses Multi choices outright; there is no prompt to cancel.
			if (entry === "cli" && choice.type === "Multi") continue;
			await openNote(obsidian, note);
			await clearDevErrors(obsidian);

			const { cliResult } = await start(obsidian, entry, choice);
			await waitForFocusedPrompt(obsidian);
			const escapes = await escapeUntilClosed(obsidian);
			const result = await outcome(obsidian, entry, cliResult);
			await obsidian.sleep(300);

			results[kind] = { escapes, devErrors: await devErrors(obsidian), result };
			expected[kind] = { escapes: 1, devErrors: NO_ERRORS, result: EXPECTED_OUTCOME[entry] };
		}

		expect(results).toEqual(expected);
	},
);

it("a floated run that fails for real still lands in dev:errors", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = await seedVaultFile(
		obsidian, sandbox, "Scripts/fail.js",
		"module.exports = async () => { throw new Error('qa real failure'); };",
	);
	const macro = new MacroChoice("Failing macro");
	macro.onePageInput = "never";
	macro.macro.commands.push(new UserScript("fail", script));
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [macro];
	}));
	await plugin.reload({ waitUntilReady: true });
	await clearDevErrors(obsidian);

	await obsidian.dev.evalJson(`(() => { void app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(macro.name)}); return true; })()`);

	await expect.poll(() => devErrors(obsidian), POLL_OPTS).toContain("qa real failure");
});

// The macro builder's two Browse buttons open a script picker from a click handler
// whose promise Obsidian drops.
it("Escape in the macro builder's script pickers leaves dev:errors empty", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await seedVaultFile(obsidian, sandbox, "Scripts/pick.js", "module.exports = async () => {};");
	const macro = new MacroChoice("Browse cancel macro");
	macro.macro.commands.push(new ConditionalCommand({ condition: { mode: "script", scriptPath: "" } }));
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [macro];
	}));
	await plugin.reload({ waitUntilReady: true });

	// Settings in the main window, as in conditional-branch-persistence.test.ts:
	// the popout's DOM adoption is nondeterministic under CLI automation.
	const popout = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('settingsPopoutWindow') ?? true");
	await obsidian.dev.evalJson("app.vault.setConfig('settingsPopoutWindow', false), true");
	const click = (selector: string, text?: string) => obsidian.dev.evalJson<boolean>(`(() => {
		const all = Array.from(document.querySelectorAll(${jsLiteral(selector)}))
			.filter((el) => ${jsLiteral(text ?? null)} === null || el.textContent.trim() === ${jsLiteral(text ?? null)});
		const target = all[all.length - 1];
		target?.click();
		return Boolean(target);
	})()`);
	const pickerOpen = () => obsidian.dev.evalJson<boolean>(
		`Boolean(document.querySelector('.prompt .prompt-input[placeholder^="Select a script"]'))`,
	);

	try {
		await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
		await expect.poll(() => click(`[aria-label="Configure ${macro.name}"]`), POLL_OPTS).toBe(true);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(".macroBuilder"))`), POLL_OPTS).toBe(true);

		// Macro builder: Browse next to "Start typing script name...".
		await clearDevErrors(obsidian);
		expect(await click(".macroBuilder button", "Browse")).toBe(true);
		await expect.poll(pickerOpen, POLL_OPTS).toBe(true);
		await pressKey(obsidian, "Escape");
		await expect.poll(pickerOpen, POLL_OPTS).toBe(false);
		await obsidian.sleep(300);
		expect(await devErrors(obsidian)).toBe(NO_ERRORS);

		// Conditional command settings: Browse for the condition script.
		expect(await click('[aria-label^="Edit condition for"]')).toBe(true);
		await expect.poll(() => obsidian.dev.evalJson<number>(
			`document.querySelectorAll(".modal-container").length`,
		), POLL_OPTS).toBeGreaterThan(1);
		await clearDevErrors(obsidian);
		expect(await click(".modal-container button", "Browse")).toBe(true);
		await expect.poll(pickerOpen, POLL_OPTS).toBe(true);
		await pressKey(obsidian, "Escape");
		await expect.poll(pickerOpen, POLL_OPTS).toBe(false);
		await obsidian.sleep(300);
		expect(await devErrors(obsidian)).toBe(NO_ERRORS);
	} finally {
		await escapeUntilClosed(obsidian);
		await obsidian.dev.evalJson(`(() => { app.setting.close(); app.vault.setConfig('settingsPopoutWindow', ${popout}); return true; })()`);
	}
});
