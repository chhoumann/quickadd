import { afterEach, beforeEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { migrateChoice } from "../../src/v3/migrate";
import type { Action, ActionNode, AddToNoteStep } from "../../src/v3/model";
import { RUN_NOTE } from "../../src/v3/model";
import { createQuickAddE2EHarness } from "./e2eVault";
import { insertText, jsLiteral, POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";

// A sequence runs step by step: a write, then a link to the note it wrote,
// then that note opened in reading view, none of which a v2 macro could hold.
const getContext = createQuickAddE2EHarness("v3-step-runner");

// At the vault's root, so the link reads [[Inbox]]; removed after.
const INBOX = "Inbox.md";
const DASHBOARD = "Dashboard.md";

let paletteWasOff = false;

const read = (path: string) =>
	getContext().obsidian.dev.evalJsonAsync<string>(`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(path)}))`);

beforeEach(async () => {
	const { obsidian } = getContext();
	paletteWasOff = false;
	expect(await obsidian.dev.evalJson<boolean>(`[${jsLiteral(INBOX)}, ${jsLiteral(DASHBOARD)}]
		.some((path) => app.vault.getAbstractFileByPath(path) !== null)`)).toBe(false);
	await obsidian.dev.evalJsonAsync(`(async () => {
		await app.vault.create(${jsLiteral(INBOX)}, "# Inbox\\n");
		await app.vault.create(${jsLiteral(DASHBOARD)}, "# Dashboard");
		return true;
	})()`);
});

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJsonAsync(`(async () => {
		app.setting.close();
		if (${paletteWasOff}) app.internalPlugins.getPluginById("command-palette").disable();
		app.workspace.getLeaf(false).setViewState({ type: "empty" });
		for (const path of [${jsLiteral(INBOX)}, ${jsLiteral(DASHBOARD)}]) {
			const file = app.vault.getAbstractFileByPath(path);
			if (file) await app.vault.delete(file);
		}
		return true;
	})()`);
});

function addToInbox(): AddToNoteStep {
	const choice = new CaptureChoice("Add to inbox");
	choice.captureTo = INBOX;
	choice.format = { enabled: true, format: "- {{VALUE}}" };
	const write = (migrateChoice(choice).node as Action).steps[0] as AddToNoteStep;
	return { ...write, id: "add", position: "bottom" };
}

it("runs a write, a link to its note, an open in reading view and a wait from the command palette", async () => {
	const { obsidian, plugin } = getContext();
	const action: Action = {
		kind: "action",
		id: "qa-step-runner",
		name: "Inbox and link",
		show: { command: true },
		onePageInput: "never",
		steps: [
			addToInbox(),
			{ id: "link", type: "link", link: RUN_NOTE, insert: { placement: "newLine", requireActiveFile: true } },
			{ id: "open", type: "open", note: RUN_NOTE, location: "reuse", direction: "vertical", mode: "preview", focus: true },
			{ id: "wait", type: "wait", time: 50 },
		],
	};
	await plugin.data<{ actions: ActionNode[]; choices?: unknown }>().patch((data) => {
		data.actions = [action];
		delete data.choices;
	});
	// Start from an empty log: it lives in run-log.json, which the harness does not restore.
	await obsidian.dev.evalJsonAsync(`(async () => {
		const path = app.plugins.plugins.quickadd.manifest.dir + "/run-log.json";
		if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
		return true;
	})()`);
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(DASHBOARD)}), { state: { mode: "source" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		leaf.view.editor.setCursor({ line: 0, ch: 0 });
		return true;
	})()`);

	// From the command palette, which the test vault keeps off.
	paletteWasOff = await obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		const palette = app.internalPlugins.getPluginById("command-palette");
		const off = !palette.enabled;
		if (off) await palette.enable();
		return off;
	})()`);
	await obsidian.dev.evalJson('app.commands.executeCommandById("command-palette:open"), true');
	await waitForElement(obsidian, ".prompt .prompt-input");
	await insertText(obsidian, "QuickAdd: Inbox and link");
	await expect.poll(() => obsidian.dev.evalJson<string | null>(
		'document.querySelector(".prompt .suggestion-item.is-selected")?.textContent.trim() ?? null',
	), POLL_OPTS).toBe("QuickAddInbox and link");
	await pressKey(obsidian, "Enter");
	await waitForElement(obsidian, ".qaInputPrompt input");
	await insertText(obsidian, "from the palette");
	await pressKey(obsidian, "Enter");

	await expect.poll(() => read(INBOX), POLL_OPTS).toBe("# Inbox\n- from the palette");
	await expect.poll(() => read(DASHBOARD), POLL_OPTS).toBe("# Dashboard\n[[Inbox]]");
	await expect.poll(() => obsidian.dev.evalJson(`(() => {
		const leaf = app.workspace.getMostRecentLeaf();
		return { file: leaf?.view.file?.path ?? null, mode: leaf?.getViewState().state?.mode ?? null };
	})()`), POLL_OPTS).toEqual({ file: INBOX, mode: "preview" });

	await obsidian.dev.evalJson("(() => { app.setting.open(); app.setting.openTabById('quickadd'); return true; })()");
	await waitForElement(obsidian, ".mod-settings .qa-run-log");
	await expect.poll(() => obsidian.dev.evalJson(`Array.from(document.querySelectorAll(".mod-settings .qa-run-log-entry"), (entry) => ({
		name: entry.querySelector(".qa-run-log-name").textContent,
		note: entry.querySelector(".qa-run-log-note")?.textContent ?? null,
	}))`), POLL_OPTS).toEqual([{ name: "Inbox and link", note: "Inbox" }]);
});
