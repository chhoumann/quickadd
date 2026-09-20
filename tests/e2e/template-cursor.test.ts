import { afterEach, describe, expect, it } from "vitest";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("template-cursor");

async function setup(template = "## Log\n### {{DATE:YYYY-MM-DD}}\n- {{cursor}}after") {
	const { obsidian, sandbox } = getContext();
	const choice = new TemplateChoice("Template cursor");
	choice.command = true;
	choice.onePageInput = "never";
	choice.templatePath = await seedVaultFile(obsidian, sandbox, `template-${choice.id}.md`, template);
	const path = sandbox.path(`result-${choice.id}.md`);
	choice.fileNameFormat = { enabled: true, format: path.slice(0, -3) };
	choice.openFile = true;
	choice.fileOpening = { location: "tab", direction: "vertical", mode: "source", focus: true };
	choice.fileExistsBehavior = { kind: "apply", mode: "overwrite" };
	return { choice, path };
}

async function save(choice: TemplateChoice) {
	const { plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(data => { data.choices.push(choice); });
	await plugin.reload({ waitUntilReady: true });
}

async function open(path: string, mode = "source") {
	await getContext().obsidian.dev.evalJsonAsync(`(async () => {
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
		content: string; editor: string; active: string; offset: number;
	}>(`(async () => {
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
		const view = app.workspace.activeLeaf?.view;
		const editor = view?.editor;
		return {
			content: file ? await app.vault.read(file) : "",
			editor: editor?.getValue() ?? "",
			active: app.workspace.getActiveFile()?.path ?? "",
			offset: editor ? editor.posToOffset(editor.getCursor()) : -1,
		};
	})()`);
}

async function run(choice: TemplateChoice, values: Record<string, string> = {}) {
	const result = await getContext().obsidian.execJson("quickadd:run", { id: choice.id, verify: true, ...values });
	expect(result).toMatchObject({ ok: true, verified: true });
}

async function expectAt(path: string, trailingText: string) {
	await expect.poll(async () => {
		const result = await state(path);
		return { active: result.active, tail: result.editor.slice(result.offset) };
	}, POLL_OPTS).toEqual({ active: path, tail: trailingText });
	const result = await state(path);
	expect(result.content).toBe(result.editor);
	return result;
}

describe("Template cursor markers in native Obsidian", () => {
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

	it("places the caret after the bullet in issue 1774's template and accepts typing there", async () => {
		const { choice, path } = await setup("## Log\n### {{VALUE:date}}\n- {{cursor}}");
		await save(choice);
		await run(choice, { "value-date": "23-Sep-2026" });
		const result = await expectAt(path, "");
		expect(result.content).toBe("## Log\n### 23-Sep-2026\n- ");
		await getContext().obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "Write here" }) });
		await expect.poll(async () => (await state(path)).editor, POLL_OPTS).toBe("## Log\n### 23-Sep-2026\n- Write here");
	});

	it.each(["command", "hotkey"])("places the caret when launched by %s", async method => {
		const { choice, path } = await setup();
		const { obsidian, sandbox } = getContext();
		const origin = await seedVaultFile(obsidian, sandbox, "origin.md", "Start here");
		await save(choice);
		await open(origin);
		if (method === "command") await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
		else {
			const modifier = await obsidian.dev.evalJson<string>("process.platform") === "darwin" ? "Mod" : "Ctrl";
			await obsidian.dev.evalJson(`(() => { app.hotkeyManager.setHotkeys(${JSON.stringify(`quickadd:choice:${choice.id}`)}, [{ modifiers: [${JSON.stringify(modifier)}, "Shift"], key: "F8" }]); return true; })()`);
			try { await pressKey(obsidian, "F8", true); }
			finally { await obsidian.dev.evalJson(`(() => { app.hotkeyManager.removeHotkeys(${JSON.stringify(`quickadd:choice:${choice.id}`)}); return true; })()`); }
		}
		await expectAt(path, "after");
	});

	it("uses the first marker, removes later markers, and counts emoji correctly", async () => {
		const { choice, path } = await setup("😀 before{{CuRsOr}}after{{CURSOR}}");
		await save(choice);
		await run(choice);
		const result = await expectAt(path, "after");
		expect(result.content).toBe("😀 beforeafter");
	});

	it("strips property markers and uses the first body marker", async () => {
		const { choice, path } = await setup('---\nstatus: "{{CURSOR}}draft"\n---\nBefore{{CURSOR}}after');
		await save(choice);
		await run(choice);
		const result = await expectAt(path, "after");
		expect(result.content).toContain('status: "draft"');
		expect(result.content).not.toContain("{{CURSOR}}");
	});

	it("keeps the usual initial position for an unmarked template", async () => {
		const { choice, path } = await setup("Start\nEnd");
		await save(choice);
		await run(choice);
		expect(await state(path)).toMatchObject({ content: "Start\nEnd", offset: 0 });
	});

	it("creates an empty note from a marker-only template", async () => {
		const { choice, path } = await setup("{{CURSOR}}");
		await save(choice);
		await run(choice);
		expect(await expectAt(path, "")).toMatchObject({ content: "", offset: 0 });
	});

	it("preserves markers through nested template includes", async () => {
		const { obsidian, sandbox } = getContext();
		const nested = await seedVaultFile(obsidian, sandbox, "nested.md", "😀{{cursor}}after");
		const { choice, path } = await setup(`Before\n{{TEMPLATE:${nested}}}`);
		await save(choice);
		await run(choice);
		expect((await expectAt(path, "after")).content).toBe("Before\n😀after");
	});

	it.each(["appendTop", "appendBottom", "overwrite"] as const)("positions in an existing note with %s and Open off", async mode => {
		const { choice, path } = await setup("Before{{CURSOR}}after");
		const { obsidian, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, `result-${choice.id}.md`, "Existing {{CURSOR}} literal\n");
		choice.fileExistsBehavior = { kind: "apply", mode };
		choice.openFile = false;
		await save(choice);
		await open(path);
		await run(choice);
		const tail = mode === "appendTop" ? "after\nExisting {{CURSOR}} literal\n" : "after";
		const result = await expectAt(path, tail);
		if (mode !== "overwrite") expect(result.content).toContain("Existing {{CURSOR}} literal");
	});

	it("keeps the marker after inserting a link into the same destination", async () => {
		const { choice, path } = await setup("Before{{CURSOR}}after");
		const { obsidian, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, `result-${choice.id}.md`, "Original\n");
		choice.fileExistsBehavior = { kind: "apply", mode: "appendBottom" };
		choice.appendLink = { enabled: true, placement: "replaceSelection", requireActiveFile: true };
		choice.openFile = false;
		await save(choice);
		await open(path);
		await run(choice);
		await expect.poll(async () => (await state(path)).content, POLL_OPTS).toContain("[[");
		expect((await expectAt(path, "after")).content).toContain("Beforeafter");
	});

	it.each(["closed", "background", "preview"] as const)("does not move another cursor for a %s destination", async mode => {
		const { choice, path } = await setup();
		const { obsidian, sandbox } = getContext();
		const origin = await seedVaultFile(obsidian, sandbox, "focus-origin.md", "Stay here");
		if (mode === "closed") choice.openFile = false;
		if (mode === "background") choice.fileOpening.focus = false;
		if (mode === "preview") choice.fileOpening.mode = "preview";
		await save(choice);
		await open(origin);
		await run(choice);
		const result = await state(path);
		expect(result.content).not.toMatch(/{{CURSOR}}/i);
		if (mode === "preview") {
			expect(await obsidian.dev.evalJson("app.workspace.activeLeaf.view.getMode()")).toBe("preview");
		} else expect(result).toMatchObject({ active: origin, editor: "Stay here", offset: 0 });
	});

	it.each(["cursor", "top", "bottom", "replace"] as const)("places the caret after applying a template in %s mode with merged properties", async mode => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "apply-template.md", "---\ntags: [new-tag]\nstatus: draft\n---\nBefore{{cursor}}after");
		const path = await seedVaultFile(obsidian, sandbox, "apply-target.md", "---\ntags: [old-tag]\n---\nExisting\n");
		await open(path);
		await obsidian.dev.evalJson("app.workspace.activeLeaf.view.editor.setCursor({line:3,ch:0}); true");
		await obsidian.dev.evalJsonAsync(`(async () => { await app.plugins.plugins.quickadd.api.applyTemplateToActiveFile(${JSON.stringify(template)}, { mode: ${JSON.stringify(mode)} }); return true; })()`);
		const tail = mode === "cursor" ? "afterExisting\n" : mode === "top" ? "after\nExisting\n" : "after";
		const result = await expectAt(path, tail);
		expect(result.content).toContain("new-tag");
		if (mode !== "replace") expect(result.content).toContain("old-tag");
		expect(result.content).not.toMatch(/{{CURSOR}}/i);
	});
});
