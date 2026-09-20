import { afterEach, describe, expect, it } from "vitest";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey, typeInto, waitForElement, expectNoPrompt } from "./uiHelpers";

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
		return {
			active: result.active,
			tail: result.editor.slice(result.offset),
			saved: result.content.replace(/\r\n?/g, "\n") === result.editor,
		};
	}, POLL_OPTS).toEqual({ active: path, tail: trailingText, saved: true });
	return state(path);
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

	it.each([
		["replaceSelection", false, false], ["replaceSelection", true, false],
		["inFrontmatter", false, false], ["inFrontmatter", true, false],
		["specifiedFile", false, false], ["specifiedFile", true, false],
		["specifiedFile", false, true], ["specifiedFile", true, true],
	] as const)("keeps the marker after a %s link to the same destination with editor update awaited=%s and marker at end=%s", async (placement, waitForEditor, atEnd) => {
		const after = atEnd ? "" : "after";
		const { choice, path } = await setup(`Before{{CURSOR}}${after}`);
		const { obsidian, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, `result-${choice.id}.md`, "Original\n");
		choice.fileExistsBehavior = { kind: "apply", mode: "appendBottom" };
		choice.appendLink = {
			enabled: true,
			placement: placement === "specifiedFile" ? "newLine" : placement,
			frontmatterProperty: "related",
			requireActiveFile: true,
			...(placement === "specifiedFile" ? { destination: { type: "specifiedFile", path } as const } : {}),
		};
		choice.openFile = true;
		choice.fileOpening.mode = "live";
		choice.copyLinkToClipboard = waitForEditor;
		await save(choice);
		await open(path);
		if (waitForEditor) await obsidian.dev.evalJson(`(() => {
			const clipboard = navigator.clipboard;
			window.__qaOriginalClipboardWrite = clipboard.writeText;
			window.__qaLinkRenderObserved = false;
			clipboard.writeText = async function(text) {
				await window.__qaOriginalClipboardWrite.call(this, text);
				const deadline = Date.now() + 2000;
				while (!app.workspace.activeLeaf.view.editor.getValue().includes("[[")) {
					if (Date.now() > deadline) throw new Error("Link did not reach the editor");
					await new Promise(resolve => setTimeout(resolve, 10));
				}
				window.__qaLinkRenderObserved = true;
			};
			return true;
		})()`);
		try {
			await run(choice);
			if (waitForEditor) expect(await obsidian.dev.evalJson("window.__qaLinkRenderObserved")).toBe(true);
		} finally {
			if (waitForEditor) await obsidian.dev.evalJson(`(() => {
				navigator.clipboard.writeText = window.__qaOriginalClipboardWrite;
				delete window.__qaOriginalClipboardWrite;
				delete window.__qaLinkRenderObserved;
				return true;
			})()`);
		}
		await expect.poll(async () => (await state(path)).content, POLL_OPTS).toContain("[[");
		const tail = placement === "specifiedFile" ? `${after}\n[[result-${choice.id}]]` : after;
		expect((await expectAt(path, tail)).content).toContain(`Before${after}`);
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

	it.each(["other-file", "same-file", "reuse-leaf", "detach-leaf"])("keeps async Apply bound to its original editor after %s", async scenario => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "deferred-template.md",
			"\n```js quickadd\nawait new Promise(resolve => { window.__applyCursorProbe.release = resolve; }); return 'Before';\n```\n{{CURSOR}}after");
		const path = await seedVaultFile(obsidian, sandbox, "deferred-target.md", "Existing");
		const other = await seedVaultFile(obsidian, sandbox, "deferred-other.md", "Other");
		await open(path);
		await obsidian.dev.evalJson(`(() => {
			const probe = window.__applyCursorProbe = { origin: app.workspace.activeLeaf };
			probe.editor = probe.origin.view.editor;
			probe.pending = app.plugins.plugins.quickadd.api.applyTemplateToActiveFile(${JSON.stringify(template)}, { mode: "cursor" })
				.then(file => { probe.result = file?.path ?? null; });
			return true;
		})()`);
		try {
			await expect.poll(() => obsidian.dev.evalJson("Boolean(window.__applyCursorProbe.release)"), POLL_OPTS).toBe(true);
			await obsidian.dev.evalJsonAsync(`(async () => {
				const probe = window.__applyCursorProbe;
				const scenario = ${JSON.stringify(scenario)};
				const leaf = scenario === "reuse-leaf" ? probe.origin : app.workspace.getLeaf("tab");
				await leaf.openFile(app.vault.getAbstractFileByPath(scenario === "same-file" ? ${JSON.stringify(path)} : ${JSON.stringify(other)}), { state: { mode: "source" } });
				app.workspace.setActiveLeaf(leaf, { focus: true });
				leaf.view.editor.setCursor({ line: 0, ch: 2 });
				if (scenario === "detach-leaf") probe.origin.detach();
				probe.active = leaf;
				probe.release();
				await probe.pending;
				for (const view of new Set([probe.origin.view, leaf.view])) {
					if (view.file) await view.save();
				}
				return true;
			})()`);
			const invalidated = scenario === "reuse-leaf" || scenario === "detach-leaf";
			const result = await obsidian.dev.evalJsonAsync<{
				result: string | null; content: string; other: string; original: string;
				activeUnchanged: boolean; cursor: { line: number; ch: number };
			}>(`(async () => {
				const probe = window.__applyCursorProbe;
				return {
					result: probe.result,
					content: await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)})),
					other: await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(other)})),
					original: probe.editor.getValue(),
					activeUnchanged: app.workspace.activeLeaf === probe.active,
					cursor: probe.active.view.editor.getCursor(),
				};
			})()`);
			expect(result).toMatchObject({
				result: invalidated ? null : path,
				content: invalidated ? "Existing" : "\nBefore\nafterExisting",
				other: "Other", activeUnchanged: true, cursor: { line: 0, ch: scenario === "same-file" ? 0 : 2 },
			});
			if (!invalidated) expect(result.original).toBe(result.content);
		} finally {
			await obsidian.dev.evalJsonAsync(`(async () => {
				const probe = window.__applyCursorProbe;
				probe.release?.();
				await probe.pending;
				delete window.__applyCursorProbe;
				return true;
			})()`);
		}
	});

	it.each(["\r\n", "\r"])("places the cursor when new-note line endings %j are normalized by the editor", async newline => {
		const { choice, path } = await setup(`First${newline}😀 Before{{CURSOR}}after`);
		await save(choice);
		await run(choice);
		await expect.poll(async () => {
			const result = await state(path);
			return { content: result.editor, tail: result.editor.slice(result.offset) };
		}, POLL_OPTS).toEqual({ content: "First\n😀 Beforeafter", tail: "after" });
		await getContext().obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "Typed " }) });
		await expect.poll(async () => (await state(path)).editor, POLL_OPTS).toBe("First\n😀 BeforeTyped after");
		await expect.poll(async () => (await state(path)).content.replace(/\r\n?/g, "\n"), POLL_OPTS).toBe("First\n😀 BeforeTyped after");
	});

	it("counts CRLF and emoji correctly after merging properties and accepts typing at the marker", async () => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "crlf-template.md", "---\r\ntags: [new-tag]\r\nstatus: draft\r\n---\r\n😀 Before{{CURSOR}}after");
		const path = await seedVaultFile(obsidian, sandbox, "crlf-target.md", "---\r\ntags: [old-tag]\r\n---\r\nExisting\r\n");
		await open(path);
		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.plugins.plugins.quickadd.api.applyTemplateToActiveFile(${JSON.stringify(template)}, { mode: "bottom" });
			return true;
		})()`);
		const result = await expectAt(path, "after");
		expect(result.content).toContain("old-tag");
		expect(result.content).toContain("new-tag");
		expect(result.editor.slice(0, result.offset)).toMatch(/😀 Before$/);
		await obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "Typed 😀 " }) });
		await expect.poll(async () => (await state(path)).editor, POLL_OPTS).toBe(result.editor.slice(0, result.offset) + "Typed 😀 " + result.editor.slice(result.offset));
	});

	it.each(["\n", "\r\n", "\r"])("keeps the marker when applying %j line endings at the cursor", async newline => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "newline-template.md", `First${newline}😀 Before{{CURSOR}}after`);
		const path = await seedVaultFile(obsidian, sandbox, "newline-target.md", "Existing");
		await open(path);
		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.plugins.plugins.quickadd.api.applyTemplateToActiveFile(${JSON.stringify(template)}, { mode: "cursor" });
			return true;
		})()`);
		await expectAt(path, "afterExisting");
		await obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "Typed " }) });
		await expect.poll(async () => {
			const result = await state(path);
			return { editor: result.editor, saved: result.content };
		}, POLL_OPTS).toEqual({ editor: "First\n😀 BeforeTyped afterExisting", saved: "First\n😀 BeforeTyped afterExisting" });
	});


	it.each([false, true])("restores Live Preview typing after Apply prompts with rename=%s", async rename => {
		const { obsidian, sandbox } = getContext();
		const { choice, path } = await setup("## {{VALUE:topic}}\n- {{cursor}}");
		const destination = rename ? sandbox.path(`renamed-${choice.id}.md`) : path;
		if (rename) {
			choice.fileNameFormat.format = destination.slice(0, -3);
			choice.templatePath = await seedVaultFile(obsidian, sandbox, "rename-template.md", `[[result-${choice.id}]]\n## {{VALUE:topic}}\n- {{cursor}}`);
		}
		await seedVaultFile(obsidian, sandbox, `result-${choice.id}.md`, "Existing notes\n");
		await save(choice);
		await open(path);
		const previousUpdateLinks = await obsidian.dev.evalJson<boolean>('app.vault.getConfig("alwaysUpdateLinks")');
		try {
			await obsidian.dev.evalJsonAsync(`(async () => {
				app.vault.setConfig("alwaysUpdateLinks", true);
				const leaf = app.workspace.activeLeaf;
				await leaf.setViewState({ type: "markdown", state: { file: ${JSON.stringify(path)}, mode: "source", source: false } });
				leaf.view.editor.focus();
				return true;
			})()`);
			await obsidian.exec("command", { id: "quickadd:applyTemplateToActiveFile" });
			await waitForElement(obsidian, ".prompt input");
			await typeInto(obsidian, ".prompt input", choice.name);
			await pressKey(obsidian, "Enter");
			await waitForElement(obsidian, 'input[placeholder="How should the template be applied?"]');
			await typeInto(obsidian, ".prompt input", "Append to bottom");
			await pressKey(obsidian, "Enter");
			await waitForElement(obsidian, ".modal input");
			await typeInto(obsidian, ".modal input", "Planning");
			await pressKey(obsidian, "Enter");
			if (rename) {
				await waitForElement(obsidian, ".qaYesNoPrompt button");
				expect(await obsidian.dev.evalJson<boolean>(`(() => {
					const yes = Array.from(document.querySelectorAll(".qaYesNoPrompt button")).find(button => button.textContent.trim() === "Yes");
					if (!(yes instanceof HTMLButtonElement)) return false;
					yes.click();
					return true;
				})()`)).toBe(true);
			}
			await expectNoPrompt(obsidian);
			await expectAt(destination, "");
			await obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "Write here" }) });
			const link = rename ? `[[renamed-${choice.id}]]\n` : "";
			await expect.poll(async () => (await state(destination)).editor, POLL_OPTS).toBe(`Existing notes\n\n${link}## Planning\n- Write here`);
			expect(await obsidian.dev.evalJson("app.workspace.activeLeaf.view.getState().source")).toBe(false);
		} finally {
			await obsidian.dev.evalJson(`(() => {
				app.vault.setConfig("alwaysUpdateLinks", ${JSON.stringify(previousUpdateLinks)});
				for (const close of document.querySelectorAll(".modal-close-button")) close.click();
				return true;
			})()`);
		}
	});

});
