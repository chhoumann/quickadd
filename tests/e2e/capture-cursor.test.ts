import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

const getContext = createQuickAddE2EHarness("capture-cursor");

async function setup(content = "# Daily\n\n## Log\n\nExisting\n") {
	const { obsidian, sandbox } = getContext();
	const choice = new CaptureChoice("Cursor capture");
	const path = await seedVaultFile(obsidian, sandbox, `note-${choice.id}.md`, content);
	choice.command = true;
	choice.captureTo = path;
	choice.captureToActiveFile = true;
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "### {{DATE:YYYY-MM-DD}}\n- {{CURSOR}}after" };
	choice.insertAfter.enabled = true;
	choice.insertAfter.after = "## Log";
	return { choice, path };
}

async function saveAndOpen(choice: CaptureChoice, path: string, mode = "source") {
	const { plugin, obsidian } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(data => { data.choices.push(choice); });
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), { state: { mode: ${JSON.stringify(mode)} } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		leaf.view.editor.setCursor({ line: 0, ch: 0 });
		leaf.view.editor.focus();
		return true;
	})()`);
}

async function state(path: string) {
	return getContext().obsidian.dev.evalJsonAsync<{
		content: string; active: string; cursor: { line: number; ch: number }; offset: number;
	}>(`(async () => {
		const editor = app.workspace.activeLeaf.view.editor;
		return { content: await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)})),
			active: app.workspace.getActiveFile()?.path, cursor: editor.getCursor(), offset: editor.posToOffset(editor.getCursor()) };
	})()`);
}

async function run(choice: CaptureChoice) {
	const result = await getContext().obsidian.execJson("quickadd:run", { id: choice.id, verify: true });
	expect(result).toMatchObject({ ok: true, verified: true });
	return result;
}

describe("Capture cursor markers in native Obsidian", () => {
	it.each(["cli", "command", "hotkey"])("places the caret inside a focused insert-after Capture through %s", async method => {
		const { choice, path } = await setup();
		const { obsidian } = getContext();
		await saveAndOpen(choice, path);
		if (method === "cli") await run(choice);
		else if (method === "command") await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
		else {
			await obsidian.dev.evalJson(`(() => {
				app.hotkeyManager.setHotkeys(${JSON.stringify(`quickadd:choice:${choice.id}`)}, [{ modifiers: ["Ctrl", "Shift"], key: "9" }]);
				return true;
			})()`);
			try {
				for (const type of ["keyDown", "keyUp"]) await obsidian.exec("dev:cdp", {
					method: "Input.dispatchKeyEvent", params: JSON.stringify({ type, key: "9", code: "Digit9", windowsVirtualKeyCode: 57, modifiers: 10 }),
				});
			} finally {
				await obsidian.dev.evalJson(`(() => { app.hotkeyManager.removeHotkeys(${JSON.stringify(`quickadd:choice:${choice.id}`)}); return true; })()`);
			}
		}
		await expect.poll(() => state(path)).toMatchObject({ cursor: { line: 5, ch: 2 } });
		const result = await state(path);
		expect(result.content).not.toMatch(/{{CURSOR}}/i);
		expect(result.content.slice(result.offset)).toBe("after\nExisting\n");
	});

	it("preserves an unmarked bottom append's existing cursor", async () => {
		const { choice, path } = await setup();
		choice.insertAfter.enabled = false;
		choice.activeFileWritePosition = "bottom";
		choice.format.format = "Added";
		await saveAndOpen(choice, path);
		await run(choice);
		expect(await state(path)).toMatchObject({ cursor: { line: 0, ch: 0 } });
	});

	it("strips markers in a background target without focusing it", async () => {
		const { choice, path } = await setup();
		const { obsidian, sandbox } = getContext();
		const other = await seedVaultFile(obsidian, sandbox, "other.md", "Stay here");
		choice.captureToActiveFile = false;
		await saveAndOpen(choice, other);
		await run(choice);
		const result = await state(path);
		expect(result).toMatchObject({ active: other, cursor: { line: 0, ch: 0 } });
		expect(result.content).toContain("- after");
		expect(result.content).not.toContain("{{CURSOR}}");
	});

	it.each(["cursor", "above", "below"] as const)("places the marker in an editor insertion %s", async position => {
		const { choice, path } = await setup("left RIGHT");
		choice.insertAfter.enabled = false;
		choice.format.format = "😀{{CURSOR}}tail{{cursor}}";
		if (position !== "cursor") choice.newLineCapture = { enabled: true, direction: position };
		await saveAndOpen(choice, path);
		await getContext().obsidian.dev.evalJson("(() => { app.workspace.activeLeaf.view.editor.setCursor({line:0,ch:5}); return true; })()");
		await run(choice);
		await expect.poll(async () => (await state(path)).content, { timeout: 5000 }).toContain("tail");
		const result = await state(path);
		expect(result.content).not.toMatch(/{{CURSOR}}/i);
		expect(result.content.slice(result.offset)).toMatch(/^tail/);
		expect(result.cursor).toEqual(position === "cursor" ? { line: 0, ch: 7 } : { line: position === "above" ? 0 : 1, ch: 2 });
	});

	it("preserves selected text when the payload contains only markers", async () => {
		const { choice, path } = await setup("Do not erase this");
		choice.insertAfter.enabled = false;
		choice.format.format = "{{CURSOR}}";
		await saveAndOpen(choice, path);
		await getContext().obsidian.dev.evalJson("(() => { app.workspace.activeLeaf.view.editor.setSelection({line:0,ch:0},{line:0,ch:6}); return true; })()");
		await run(choice);
		expect((await state(path)).content).toBe("Do not erase this");
		expect(await getContext().obsidian.dev.evalJson("app.workspace.activeLeaf.view.editor.getSelection()")).toBe("Do not");
	});

	it("maps the marker into every replaced selection", async () => {
		const { choice, path } = await setup("one gap two");
		choice.insertAfter.enabled = false;
		choice.format.format = "A{{CURSOR}}tail";
		await saveAndOpen(choice, path);
		const { obsidian } = getContext();
		await obsidian.dev.evalJson(`(() => {
			app.workspace.activeLeaf.view.editor.setSelections([
				{anchor:{line:0,ch:3},head:{line:0,ch:0}},
				{anchor:{line:0,ch:8},head:{line:0,ch:11}}
			]); return true;
		})()`);
		await run(choice);
		await expect.poll(async () => (await state(path)).content, { timeout: 5000 }).toBe("Atail gap Atail");
		expect(await obsidian.dev.evalJson(`app.workspace.activeLeaf.view.editor.listSelections().map(s => s.head.ch)`)).toEqual([1, 11]);
	});

	it.each(["top", "bottom"] as const)("places marked %s Captures in the focused note without Open", async position => {
		const { choice, path } = await setup("Original");
		choice.insertAfter.enabled = false;
		choice.activeFileWritePosition = position;
		choice.format.format = "{{CURSOR}}tail";
		await saveAndOpen(choice, path);
		await run(choice);
		const result = await state(path);
		expect(result.content.slice(result.offset)).toMatch(/^tail/);
	});

	it("opens and focuses a configured target before placing its marker", async () => {
		const { choice, path } = await setup();
		const { obsidian, sandbox } = getContext();
		const other = await seedVaultFile(obsidian, sandbox, "open-origin.md", "Original");
		choice.captureToActiveFile = false;
		choice.openFile = true;
		await saveAndOpen(choice, other);
		await run(choice);
		const result = await state(path);
		expect(result.active).toBe(path);
		expect(result.content.slice(result.offset)).toBe("after\nExisting\n");
	});

	it("strips property markers without changing the note body or cursor", async () => {
		const { choice, path } = await setup("---\nstatus: old\n---\nBody");
		choice.propertyCapture = { property: { kind: "named", format: "status" }, action: "set", createIfMissing: false };
		choice.format.format = "before{{CURSOR}}after";
		await saveAndOpen(choice, path);
		await getContext().obsidian.dev.evalJson("(() => { app.workspace.activeLeaf.view.editor.setCursor({line:3,ch:2}); return true; })()");
		await run(choice);
		const result = await state(path);
		expect(result.content).toContain("status: beforeafter");
		expect(result.content).toContain("\nBody");
		expect(result.cursor).toEqual({line: 3, ch: 2});
	});

	it("strips markers in a Canvas text card without focusing it", async () => {
		const { choice, path } = await setup("Stay here");
		const { obsidian, sandbox } = getContext();
		const canvas = await seedVaultFile(obsidian, sandbox, "cursor.canvas", JSON.stringify({ nodes: [{ id: "card", type: "text", text: "Original", x: 0, y: 0, width: 300, height: 200 }], edges: [] }));
		choice.captureTo = canvas;
		choice.captureToActiveFile = false;
		choice.captureToCanvasNodeId = "card";
		choice.insertAfter.enabled = false;
		choice.format.format = "before{{CURSOR}}after";
		await saveAndOpen(choice, path);
		await run(choice);
		const result = await state(canvas);
		expect(JSON.parse(result.content).nodes[0].text).toContain("beforeafter");
		expect(result.content).not.toContain("{{CURSOR}}");
		expect(result.active).toBe(path);
		expect(result.cursor).toEqual({line: 0, ch: 0});
	});

	it("does not create a missing target for a marker-only capture", async () => {
		const { choice, path } = await setup();
		const { obsidian, sandbox } = getContext();
		choice.captureTo = sandbox.path("absent.md");
		choice.captureToActiveFile = false;
		choice.createFileIfItDoesntExist.enabled = true;
		choice.insertAfter.enabled = false;
		choice.format.format = "{{CURSOR}}";
		await saveAndOpen(choice, path);
		await run(choice);
		expect(await obsidian.dev.evalJson(`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(choice.captureTo)}))`)).toBe(false);
	});

	it("does not open or rewrite an existing background target for a marker-only capture", async () => {
		const { choice, path } = await setup();
		const { obsidian, sandbox } = getContext();
		const other = await seedVaultFile(obsidian, sandbox, "empty-origin.md", "Stay here");
		choice.captureToActiveFile = false;
		choice.openFile = true;
		choice.templater = { afterCapture: "wholeFile" };
		choice.format.format = "{{CURSOR}}";
		await saveAndOpen(choice, other);
		const before = await obsidian.dev.evalJson(`app.vault.getAbstractFileByPath(${JSON.stringify(path)}).stat.mtime`);
		expect(await run(choice)).toMatchObject({ file: path, effect: "unchanged" });
		expect((await state(path)).active).toBe(other);
		expect(await obsidian.dev.evalJson(`app.vault.getAbstractFileByPath(${JSON.stringify(path)}).stat.mtime`)).toBe(before);
	});

	it("keeps markers from an included template in Capture scope", async () => {
		const { choice, path } = await setup();
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "snippet.md", "before{{CURSOR}}after");
		choice.format.format = `{{TEMPLATE:${template}}}`;
		await saveAndOpen(choice, path);
		await run(choice);
		const result = await state(path);
		expect(result.content.slice(result.offset)).toBe("after\nExisting\n");
		expect(result.content).not.toContain("{{CURSOR}}");
	});
});
