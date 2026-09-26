import { afterEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

// Writes into a note open in an editor must land in that editor before the
// run resolves (#1798): Obsidian re-reads notes over its 64K-character cache
// from disk asynchronously, and merges unsaved typing behind a notice.
const getContext = createQuickAddE2EHarness("open-note-writes");
const MERGE_NOTICE = /modified externally/i;

type Snapshot = {
	editor: string; disk: string; cursor: { line: number; ch: number }; offset: number; notices: string[]; mode: string;
};

/** Seeds `head` followed by generated filler up to about `kb` KB, in-app so the CLI argv stays small. */
async function seedNote(name: string, head: string, kb = 0): Promise<string> {
	const { obsidian, sandbox } = getContext();
	const path = await seedVaultFile(obsidian, sandbox, name, "");
	await obsidian.dev.evalJsonAsync(`(async () => {
		const filler = Array.from({ length: Math.ceil(${kb} * 1024 / 58) }, (_, i) => "Line " + i + " lorem ipsum dolor sit amet, consectetur adipiscing").join("\\n");
		await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), ${JSON.stringify(head)} + filler);
		return true;
	})()`);
	return path;
}

async function saveChoice(choice: IChoice) {
	const { plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(data => { data.choices.push(choice); });
	await plugin.reload({ waitUntilReady: true });
}

async function open(path: string, cursor: { line: number; ch: number }, mode = "source") {
	await getContext().obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), { state: { mode: ${JSON.stringify(mode)} } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		leaf.view.editor.setCursor(${JSON.stringify(cursor)});
		leaf.view.editor.focus();
		for (const notice of document.querySelectorAll(".notice")) notice.remove();
		return true;
	})()`);
}

/**
 * Runs `action` in-app and snapshots the active editor in the same tick the
 * run resolves: no polling, so an editor that catches up late fails.
 */
async function runAndSnapshot(path: string, action: string): Promise<Snapshot> {
	return getContext().obsidian.dev.evalJsonAsync<Snapshot>(`(async () => {
		${action}
		const view = app.workspace.activeLeaf.view;
		const editor = view.editor;
		const cursor = editor.getCursor();
		return {
			editor: editor.getValue(),
			disk: await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)})),
			cursor, offset: editor.posToOffset(cursor), mode: view.getMode(),
			notices: [...document.querySelectorAll(".notice")].map(notice => notice.textContent ?? ""),
		};
	})()`);
}

const executeChoice = (choice: IChoice) =>
	`await app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(choice.name)});`;

function captureChoice(format = "- captured {{CURSOR}}") {
	const choice = new CaptureChoice(`Open note capture`);
	choice.captureToActiveFile = true;
	choice.onePageInput = "never";
	choice.format = { enabled: true, format };
	choice.insertAfter.enabled = true;
	choice.insertAfter.after = "# Encounters";
	return choice;
}

const HEAD = "# Encounters\n- first\n\n";

describe("Writes into an open note land in its editor (#1798)", () => {
	afterEach(async () => {
		const { obsidian, sandbox } = getContext();
		await obsidian.dev.evalJsonAsync(`(async () => {
			for (const leaf of app.workspace.getLeavesOfType("markdown")) {
				if (leaf.view.file?.path.startsWith(${JSON.stringify(sandbox.path(""))})) {
					await leaf.view.save();
					leaf.detach();
				}
			}
			return true;
		})()`);
	});

	it.each([2, 60, 70, 132, 250, 1024])("places the Capture cursor in a %d KB active note as the run resolves", async kb => {
		const choice = captureChoice();
		const path = await seedNote(`capture-${kb}.md`, HEAD, kb);
		await saveChoice(choice);
		await open(path, { line: 5, ch: 3 });
		const result = await runAndSnapshot(path, executeChoice(choice));
		expect(result.cursor).toEqual({ line: 1, ch: "- captured ".length });
		expect(result.editor.startsWith("# Encounters\n- captured \n- first\n")).toBe(true);
		expect(result.disk).toBe(result.editor);
		expect(result.notices.filter(notice => MERGE_NOTICE.test(notice))).toEqual([]);
	});

	it.each([2, 250])("keeps typing that was not autosaved yet in a %d KB note, without a merge notice", async kb => {
		const choice = captureChoice();
		const path = await seedNote(`dirty-${kb}.md`, HEAD, kb);
		await saveChoice(choice);
		await open(path, { line: 3, ch: 0 });
		const result = await runAndSnapshot(path, `
			app.workspace.activeLeaf.view.editor.replaceRange("typed ", { line: 3, ch: 0 });
			${executeChoice(choice)}
		`);
		expect(result.editor.split("\n").slice(0, 5)).toEqual(["# Encounters", "- captured ", "- first", "", "typed Line 0 lorem ipsum dolor sit amet, consectetur adipiscing"]);
		expect(result.cursor).toEqual({ line: 1, ch: "- captured ".length });
		expect(result.disk).toBe(result.editor);
		expect(result.notices.filter(notice => MERGE_NOTICE.test(notice))).toEqual([]);
	});

	it("keeps the cursor when the whole-file Templater pass leaves the note unchanged", async () => {
		const choice = captureChoice();
		choice.templater = { afterCapture: "wholeFile" };
		const path = await seedNote("templater-noop.md", HEAD, 132);
		await saveChoice(choice);
		await open(path, { line: 5, ch: 3 });
		const result = await runAndSnapshot(path, executeChoice(choice));
		expect(result.cursor).toEqual({ line: 1, ch: "- captured ".length });
	});

	it("undoes a Capture into a large note in one step", async () => {
		const choice = captureChoice();
		const path = await seedNote("undo.md", HEAD, 250);
		await saveChoice(choice);
		await open(path, { line: 5, ch: 3 });
		const original = await getContext().obsidian.dev.evalJson<string>("app.workspace.activeLeaf.view.editor.getValue()");
		await runAndSnapshot(path, executeChoice(choice));
		expect(await getContext().obsidian.dev.evalJson<string>(`(() => {
			const editor = app.workspace.activeLeaf.view.editor;
			editor.undo();
			return editor.getValue();
		})()`)).toBe(original);
	});

	it("keeps unsaved typing in a background pane that a Capture targets by path", async () => {
		const { obsidian } = getContext();
		const choice = captureChoice("- captured");
		const target = await seedNote("background-target.md", HEAD, 250);
		const other = await seedNote("background-active.md", "Stay here\n");
		choice.captureToActiveFile = false;
		choice.captureTo = target;
		await saveChoice(choice);
		await open(target, { line: 3, ch: 0 });
		await obsidian.dev.evalJsonAsync(`(async () => {
			app.workspace.activeLeaf.view.editor.replaceRange("typed ", { line: 3, ch: 0 });
			const leaf = app.workspace.getLeaf("split");
			await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(other)}), { state: { mode: "source" } });
			app.workspace.setActiveLeaf(leaf, { focus: true });
			return true;
		})()`);
		const result = await runAndSnapshot(other, executeChoice(choice));
		expect(result.editor).toBe("Stay here\n");
		const targetState = await obsidian.dev.evalJsonAsync<{ editor: string; disk: string }>(`(async () => {
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(target)});
			const leaf = app.workspace.getLeavesOfType("markdown").find(leaf => leaf.view.file === file);
			return { editor: leaf.view.editor.getValue(), disk: await app.vault.read(file) };
		})()`);
		expect(targetState.editor.split("\n").slice(0, 5)).toEqual(["# Encounters", "- captured", "- first", "", "typed Line 0 lorem ipsum dolor sit amet, consectetur adipiscing"]);
		expect(targetState.disk).toBe(targetState.editor);
		expect(result.notices.filter(notice => MERGE_NOTICE.test(notice))).toEqual([]);
	});

	it("writes a Capture into a large note shown in reading view", async () => {
		const { obsidian } = getContext();
		const choice = captureChoice("- captured {{CURSOR}}here");
		const path = await seedNote("reading.md", HEAD, 250);
		await saveChoice(choice);
		await open(path, { line: 0, ch: 0 }, "preview");
		const result = await runAndSnapshot(path, executeChoice(choice));
		expect(result.mode).toBe("preview");
		expect(result.disk.startsWith("# Encounters\n- captured here\n- first\n")).toBe(true);
		// Obsidian's reading view itself skips re-rendering large notes after a
		// vault write, so check the view's text rather than its rendered DOM.
		await expect.poll(() => obsidian.dev.evalJson<string>("app.workspace.activeLeaf.view.data"), POLL_OPTS)
			.toBe(result.disk);
	});

	it.each(["top", "bottom"] as const)("places the cursor after applying a template to a large note's %s", async mode => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, `apply-${mode}.md`, "---\ntags: [new-tag]\n---\nBefore{{cursor}}after");
		const path = await seedNote(`apply-target-${mode}.md`, "---\ntags: [old-tag]\n---\n" + HEAD, 250);
		await open(path, { line: 5, ch: 0 });
		const result = await runAndSnapshot(path, `
			await app.plugins.plugins.quickadd.api.applyTemplateToActiveFile(${JSON.stringify(template)}, { mode: ${JSON.stringify(mode)} });
		`);
		expect(result.editor.slice(result.offset - "Before".length, result.offset + "after".length)).toBe("Beforeafter");
		expect(result.disk).not.toMatch(/{{CURSOR}}/i);
		expect(result.notices.filter(notice => MERGE_NOTICE.test(notice))).toEqual([]);
		await expect.poll(async () => (await runAndSnapshot(path, "")).disk, POLL_OPTS).toMatch(/old-tag[\s\S]*new-tag/);
	});

	it.each(["top", "bottom"] as const)("places the cursor from a CRLF template applied to the %s of an open note", async mode => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, `crlf-body-${mode}.md`, "First\r\nSecond\r\nBefore{{CURSOR}}after");
		const path = await seedNote(`crlf-body-target-${mode}.md`, HEAD);
		await open(path, { line: 1, ch: 0 });
		const result = await runAndSnapshot(path, `
			await app.plugins.plugins.quickadd.api.applyTemplateToActiveFile(${JSON.stringify(template)}, { mode: ${JSON.stringify(mode)} });
		`);
		expect(result.editor.slice(result.offset - "Before".length, result.offset + "after".length)).toBe("Beforeafter");
	});

	it("merges template properties into a note with unsaved typing without a merge notice", async () => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "apply-cursor.md", "---\nstatus: draft\n---\nInserted");
		const path = await seedNote("apply-cursor-target.md", "---\ntags: [old-tag]\n---\nExisting\n");
		await open(path, { line: 3, ch: 8 });
		const result = await runAndSnapshot(path, `
			app.workspace.activeLeaf.view.editor.replaceRange("typed ", { line: 3, ch: 0 });
			await app.plugins.plugins.quickadd.api.applyTemplateToActiveFile(${JSON.stringify(template)}, { mode: "cursor" });
		`);
		expect(result.notices.filter(notice => MERGE_NOTICE.test(notice))).toEqual([]);
		await expect.poll(async () => (await runAndSnapshot(path, "")).disk, POLL_OPTS)
			.toMatch(/status: draft[\s\S]*typed ExistingInserted/);
	});

	it("does not treat a new note with unsaved typing as empty when applying a template", async () => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "apply-empty.md", "Template body");
		const path = await seedNote("fresh-note.md", "");
		await open(path, { line: 0, ch: 0 });
		const result = await runAndSnapshot(path, `
			app.workspace.activeLeaf.view.editor.replaceRange("My first thought", { line: 0, ch: 0 });
			await app.plugins.plugins.quickadd.api.applyTemplateToActiveFile(${JSON.stringify(template)});
		`);
		expect(result.editor).toContain("My first thought");
		expect(result.editor).toContain("Template body");
		expect(result.disk).toBe(result.editor);
	});

	it("never leaves a cursor marker when a large template overwrites the open note", async () => {
		const templatePath = await seedNote("large-template.md", "# Fresh\n{{CURSOR}}\n", 250);
		const path = await seedNote("overwrite-target.md", "Old\n");
		const choice = new TemplateChoice("Large overwrite");
		choice.templatePath = templatePath;
		choice.onePageInput = "never";
		choice.fileNameFormat = { enabled: true, format: path.slice(0, -3) };
		choice.fileExistsBehavior = { kind: "apply", mode: "overwrite" };
		await saveChoice(choice);
		await open(path, { line: 0, ch: 0 });
		const result = await runAndSnapshot(path, executeChoice(choice));
		expect(result.editor).not.toMatch(/{{CURSOR}}/i);
		expect(result.disk).not.toMatch(/{{CURSOR}}/i);
		expect(result.cursor).toEqual({ line: 1, ch: 0 });
		expect(result.editor.startsWith("# Fresh\n\nLine 0")).toBe(true);
	});
});
