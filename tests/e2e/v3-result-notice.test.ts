import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, jsLiteral, POLL_OPTS } from "./uiHelpers";

// After a run, one notice says what it did and where, with Open and Undo.
const getContext = createQuickAddE2EHarness("v3-result-notice");

const OPEN = ".notice .qa-result-notice-actions button:first-child";
const UNDO = ".notice .qa-result-notice-actions button:last-child";

/** Each notice on screen: its text without the buttons, and the buttons. */
const notices = `Array.from(document.querySelectorAll(".notice"), (notice) => {
	const text = notice.cloneNode(true);
	text.querySelectorAll("button").forEach((button) => button.remove());
	return { text: text.textContent.trim(), buttons: Array.from(notice.querySelectorAll("button"), (b) => b.textContent) };
})`;

async function store(choice: IChoice) {
	const { plugin } = getContext();
	choice.command = true;
	choice.onePageInput = "never";
	await plugin.data<{ choices: IChoice[]; showCaptureNotification: boolean }>().patch(withStoredChoices((data) => {
		data.choices = [choice];
		data.showCaptureNotification = true;
	}));
	await plugin.reload({ waitUntilReady: true });
}

async function runFromCommand(choice: IChoice) {
	await getContext().obsidian.dev.evalJson(`(() => {
		document.querySelectorAll(".notice").forEach((notice) => notice.remove());
		app.commands.executeCommandById(${jsLiteral(`quickadd:choice:${choice.id}`)});
		return true;
	})()`);
}

async function logCapture(): Promise<{ choice: CaptureChoice; before: string }> {
	const { obsidian, sandbox } = getContext();
	const before = "# Log\n\n- earlier\n";
	const path = await seedVaultFile(obsidian, sandbox, "notes/log.md", before);
	const choice = new CaptureChoice("Log");
	choice.captureTo = path;
	choice.format = { enabled: true, format: "- from the capture" };
	await store(choice);
	// Nothing open, so a note in view got there through the notice.
	await obsidian.dev.evalJson(`(() => { app.workspace.getLeaf(false).setViewState({ type: "empty" }); return true; })()`);
	return { choice, before };
}

it("says a capture added to the note and undoes it", async () => {
	const { obsidian, sandbox } = getContext();
	const { choice, before } = await logCapture();

	await runFromCommand(choice);
	await expect.poll(() => obsidian.dev.evalJson(notices), POLL_OPTS)
		.toEqual([{ text: "Log: added to 'log'", buttons: ["Open", "Undo"] }]);
	expect(await sandbox.read("notes/log.md")).toContain("- from the capture");

	await clickWhenStill(obsidian, UNDO);
	await expect.poll(() => sandbox.read("notes/log.md"), POLL_OPTS).toBe(before);
	await expect.poll(() => obsidian.dev.evalJson(notices), POLL_OPTS).toEqual([{ text: "Undone", buttons: [] }]);
});

it("opens the note it wrote to", async () => {
	const { obsidian } = getContext();
	const { choice } = await logCapture();

	await runFromCommand(choice);
	await clickWhenStill(obsidian, OPEN);
	await expect.poll(() => obsidian.dev.evalJson<string | null>("app.workspace.getActiveFile()?.path ?? null"), POLL_OPTS)
		.toBe(choice.captureTo);
});

it("moves a note a template created to the trash on Undo", async () => {
	const { obsidian, sandbox } = getContext();
	const choice = new TemplateChoice("New page");
	choice.templatePath = await seedVaultFile(obsidian, sandbox, "templates/page.md", "# Page\n");
	choice.fileNameFormat = { enabled: true, format: sandbox.path("notes/new page") };
	await store(choice);
	const created = sandbox.path("notes/new page.md");
	const exists = () => obsidian.dev.evalJson<boolean>(`app.vault.getAbstractFileByPath(${jsLiteral(created)}) !== null`);

	await runFromCommand(choice);
	await expect.poll(() => obsidian.dev.evalJson(notices), POLL_OPTS)
		.toEqual([{ text: "New page: created 'new page'", buttons: ["Open", "Undo"] }]);
	expect(await exists()).toBe(true);

	await clickWhenStill(obsidian, UNDO);
	await expect.poll(exists, POLL_OPTS).toBe(false);
	await expect.poll(() => obsidian.dev.evalJson(notices), POLL_OPTS).toEqual([{ text: "Undone", buttons: [] }]);
});

it("keeps a note changed since the run and opens it instead of undoing", async () => {
	const { obsidian, sandbox } = getContext();
	const { choice } = await logCapture();

	await runFromCommand(choice);
	await expect.poll(() => obsidian.dev.evalJson(notices), POLL_OPTS)
		.toEqual([{ text: "Log: added to 'log'", buttons: ["Open", "Undo"] }]);
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = app.vault.getAbstractFileByPath(${jsLiteral(choice.captureTo)});
		await app.vault.process(file, (content) => content + "- typed later\\n");
		return true;
	})()`);
	const edited = await sandbox.read("notes/log.md");
	expect(edited).toContain("- typed later");

	await clickWhenStill(obsidian, UNDO);
	await expect.poll(() => obsidian.dev.evalJson(notices), POLL_OPTS)
		.toEqual([{ text: "Changed since, opened instead", buttons: [] }]);
	expect(await sandbox.read("notes/log.md")).toBe(edited);
	expect(await obsidian.dev.evalJson<string | null>("app.workspace.getActiveFile()?.path ?? null")).toBe(choice.captureTo);
});
