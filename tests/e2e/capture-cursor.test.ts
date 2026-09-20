import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("capture-cursor");
const AUTOSAVE_POLL = { ...POLL_OPTS, timeout: 5_000 };

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
		content: string; editorContent: string; active: string; cursor: { line: number; ch: number }; offset: number;
	}>(`(async () => {
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
		const view = app.workspace.activeLeaf?.view;
		const editor = view?.editor;
		const active = app.workspace.getActiveFile()?.path;
		const cursor = editor?.getCursor() ?? { line: -1, ch: -1 };
		return {
			content: await app.vault.read(file),
			editorContent: editor && view?.file?.path === ${JSON.stringify(path)} ? editor.getValue() : "",
			active,
			cursor,
			offset: editor ? editor.posToOffset(cursor) : -1,
		};
	})()`);
}

async function closeCaptureBuilders() {
	await getContext().obsidian.dev.evalJson(`(() => {
		for (const builder of [...document.querySelectorAll(".captureChoiceBuilder")]) {
			const done = [...builder.querySelectorAll("button.mod-cta")]
				.find(button => button.textContent?.trim() === "Done");
			done?.click();
		}
		app.setting?.close?.();
		return true;
	})()`);
	await expect.poll(() => getContext().obsidian.dev.evalJson(`(() =>
		[...document.querySelectorAll(".captureChoiceBuilder")]
			.filter(builder => builder.getClientRects().length > 0).length
	)()`), AUTOSAVE_POLL).toBe(0);
}

async function withLatestCaptureBuilder<T>(expression: string): Promise<T> {
	return getContext().obsidian.dev.evalJson<T>(`(() => {
		const builders = [...document.querySelectorAll(".captureChoiceBuilder")]
			.filter(builder => builder.getClientRects().length > 0);
		const builder = builders.at(-1);
		if (!builder) throw new Error("Capture builder not open");
		return (${expression});
	})()`);
}

async function typeIntoLatestCaptureFormat(text: string) {
	const focused = await withLatestCaptureBuilder<boolean>(`(() => {
		const input = builder.querySelector('textarea[placeholder="Format"], textarea[placeholder="One item per line"]');
		if (!(input instanceof HTMLTextAreaElement)) return false;
		input.focus();
		input.select();
		return true;
	})()`);
	expect(focused).toBe(true);
	await getContext().obsidian.exec("dev:cdp", {
		method: "Input.insertText",
		params: JSON.stringify({ text }),
	});
}

async function enableCaptureNotices() {
	await getContext().plugin.data<{ showCaptureNotification: boolean }>().patch(data => {
		data.showCaptureNotification = true;
	});
	await getContext().plugin.reload({ waitUntilReady: true });
}

async function clearNotices() {
	await getContext().obsidian.dev.evalJson(`(() => {
		for (const notice of document.querySelectorAll(".notice")) notice.remove();
		return true;
	})()`);
}

async function visibleNotices() {
	return getContext().obsidian.dev.evalJson<string[]>(`(() =>
		[...document.querySelectorAll(".notice")]
			.filter(notice => notice.getClientRects().length > 0)
			.map(notice => notice.textContent?.trim() ?? "")
	)()`);
}

async function expectOneNothingToCaptureNotice() {
	await expect.poll(() => visibleNotices(), AUTOSAVE_POLL).toHaveLength(1);
	expect(await visibleNotices()).toEqual([expect.stringMatching(/nothing to capture/i)]);
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
			const modifier = await obsidian.dev.evalJson<string>("process.platform") === "darwin" ? "Mod" : "Ctrl";
			await obsidian.dev.evalJson(`(() => {
				app.hotkeyManager.setHotkeys(${JSON.stringify(`quickadd:choice:${choice.id}`)}, [{ modifiers: [${JSON.stringify(modifier)}, "Shift"], key: "F8" }]);
				return true;
			})()`);
			try {
				await pressKey(obsidian, "F8", true);
			} finally {
				await obsidian.dev.evalJson(`(() => { app.hotkeyManager.removeHotkeys(${JSON.stringify(`quickadd:choice:${choice.id}`)}); return true; })()`);
			}
		}
		await expect.poll(() => state(path), AUTOSAVE_POLL).toMatchObject({ cursor: { line: 5, ch: 2 } });
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

	it.each(["cursor", "top", "bottom", "above", "below"] as const)("places the marker after linking from a %s capture in the same note", async position => {
		const { choice, path } = await setup("Original\n");
		choice.insertAfter.enabled = false;
		choice.format.format = "A{{CURSOR}}B";
		choice.appendLink = { enabled: true, placement: "replaceSelection", requireActiveFile: true };
		if (position === "above" || position === "below") choice.newLineCapture = { enabled: true, direction: position };
		else choice.activeFileWritePosition = position;
		await saveAndOpen(choice, path);
		await run(choice);
		await expect.poll(async () => {
			const result = await state(path);
			return { linked: result.content.includes("[["), savedMarker: result.content.includes("AB") };
		}, AUTOSAVE_POLL).toEqual({ linked: true, savedMarker: true });
		const result = await state(path);
		expect(result.editorContent.slice(result.offset - 1, result.offset + 1)).toBe("AB");
	});

	it.each(["afterSelection", "endOfLine", "newLine"] as const)("keeps the marker across %s link placement", async placement => {
		const { choice, path } = await setup("Original\n");
		choice.insertAfter.enabled = false;
		choice.format.format = "A{{CURSOR}}B";
		choice.appendLink = { enabled: true, placement, requireActiveFile: true };
		await saveAndOpen(choice, path);
		await run(choice);
		await expect.poll(async () => (await state(path)).content, AUTOSAVE_POLL).toContain("[[");
		const result = await state(path);
		expect(result.content).toContain("AB");
		expect(result.editorContent.slice(result.offset - 1, result.offset + 1)).toBe("AB");
	});

	it("maps every marker after appending links at multiple selections", async () => {
		const { choice, path } = await setup("one gap two");
		const { obsidian } = getContext();
		choice.insertAfter.enabled = false;
		choice.format.format = "A{{CURSOR}}B";
		choice.appendLink = { enabled: true, placement: "replaceSelection", requireActiveFile: true };
		await saveAndOpen(choice, path);
		await obsidian.dev.evalJson(`(() => {
			app.workspace.activeLeaf.view.editor.setSelections([
				{anchor:{line:0,ch:0},head:{line:0,ch:3}},
				{anchor:{line:0,ch:8},head:{line:0,ch:11}}
			]); return true;
		})()`);
		await run(choice);
		expect(await obsidian.dev.evalJson(`(() => {
			const editor = app.workspace.activeLeaf.view.editor;
			const content = editor.getValue();
			return { links: content.split("[[").length - 1, markers: editor.listSelections().map(selection => {
				const offset = editor.posToOffset(selection.head);
				return content.slice(offset - 1, offset + 1);
			}) };
		})()`)).toEqual({ links: 2, markers: ["AB", "AB"] });
	});

	it.each([
		["cursor", "\r\n"], ["above", "\r\n"], ["below", "\r\n"],
		["cursor", "\r"], ["above", "\r"], ["below", "\r"],
	] as const)("keeps the marker in a %s capture with %j line endings", async (position, newline) => {
		const { choice, path } = await setup("Existing");
		const { obsidian } = getContext();
		choice.insertAfter.enabled = false;
		choice.format.format = `First${newline}😀 Before{{CURSOR}}after`;
		if (position !== "cursor") choice.newLineCapture = { enabled: true, direction: position };
		await saveAndOpen(choice, path);
		await run(choice);
		const inserted = "First\n😀 BeforeTyped after";
		const expected = position === "below" ? `Existing\n${inserted}` : inserted + (position === "above" ? "\nExisting" : "Existing");
		const beforeTyping = expected.replace("Typed ", "");
		await expect.poll(async () => {
			const result = await state(path);
			return { editor: result.editorContent, saved: result.content, offset: result.offset };
		}, AUTOSAVE_POLL).toEqual({ editor: beforeTyping, saved: beforeTyping, offset: beforeTyping.indexOf("after") });
		await obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "Typed " }) });
		await expect.poll(async () => {
			const result = await state(path);
			return { editor: result.editorContent, saved: result.content };
		}, AUTOSAVE_POLL).toEqual({ editor: expected, saved: expected });
	});

	it("maps CRLF insertions at multiple selections before typing", async () => {
		const { choice, path } = await setup("one gap two");
		const { obsidian } = getContext();
		choice.insertAfter.enabled = false;
		choice.format.format = "First\r\n😀 Before{{CURSOR}}after";
		await saveAndOpen(choice, path);
		await obsidian.dev.evalJson(`(() => {
			app.workspace.activeLeaf.view.editor.setSelections([
				{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 3 } },
				{ anchor: { line: 0, ch: 11 }, head: { line: 0, ch: 8 } },
			]); return true;
		})()`);
		await run(choice);
		await expect.poll(async () => {
			const result = await state(path);
			return { editor: result.editorContent, saved: result.content };
		}, AUTOSAVE_POLL).toEqual({ editor: "First\n😀 Beforeafter gap First\n😀 Beforeafter", saved: "First\n😀 Beforeafter gap First\n😀 Beforeafter" });
		expect(await obsidian.dev.evalJson(`(() => {
			const editor = app.workspace.activeLeaf.view.editor;
			return editor.listSelections().map(selection => editor.getValue().slice(editor.posToOffset(selection.head), editor.posToOffset(selection.head) + 5));
		})()`)).toEqual(["after", "after"]);
		await obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "Typed " }) });
		const expected = "First\n😀 BeforeTyped after gap First\n😀 BeforeTyped after";
		await expect.poll(async () => {
			const result = await state(path);
			return { editor: result.editorContent, saved: result.content };
		}, AUTOSAVE_POLL).toEqual({ editor: expected, saved: expected });
	});

	it("places one marker at the end of a replaced selection after inserting multiple links", async () => {
		const { choice, path } = await setup("ab tail");
		const { obsidian } = getContext();
		choice.insertAfter.after = "ab";
		choice.insertAfter.inline = true;
		choice.format.format = "{{CURSOR}}X";
		choice.useSelectionAsCaptureValue = false;
		choice.appendLink = { enabled: true, placement: "replaceSelection", requireActiveFile: true };
		await saveAndOpen(choice, path);
		await obsidian.dev.evalJson(`(() => {
			app.workspace.activeLeaf.view.editor.setSelections([
				{anchor:{line:0,ch:0},head:{line:0,ch:2}},
				{anchor:{line:0,ch:3},head:{line:0,ch:7}}
			]); return true;
		})()`);
		await run(choice);
		await expect.poll(async () => (await state(path)).content, AUTOSAVE_POLL).toContain("]]X [[");
		expect(await obsidian.dev.evalJson(`(() => {
			const editor = app.workspace.activeLeaf.view.editor;
			return editor.listSelections().map(selection => editor.getValue().slice(editor.posToOffset(selection.head), editor.posToOffset(selection.head) + 1));
		})()`)).toEqual(["X"]);
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
		await expect.poll(async () => (await state(path)).content, AUTOSAVE_POLL).toContain("tail");
		const result = await state(path);
		expect(result.content).not.toMatch(/{{CURSOR}}/i);
		expect(result.editorContent.slice(result.offset)).toMatch(/^tail/);
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
		await expect.poll(async () => (await state(path)).content, AUTOSAVE_POLL).toBe("Atail gap Atail");
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
		expect(result.content).toContain("tail");
		expect(result.editorContent.slice(result.offset)).toMatch(/^tail/);
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
		await enableCaptureNotices();
		choice.captureTo = sandbox.path("absent.md");
		choice.captureToActiveFile = false;
		choice.createFileIfItDoesntExist.enabled = true;
		choice.insertAfter.enabled = false;
		choice.format.format = "{{CURSOR}}";
		await saveAndOpen(choice, path);
		await clearNotices();
		await run(choice);
		await expectOneNothingToCaptureNotice();
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

	it.each(["note", "editor", "canvas"] as const)("shows a nothing-to-capture notice for marker-only %s captures", async mode => {
		const { choice, path } = await setup("Original");
		const { obsidian, sandbox } = getContext();
		await enableCaptureNotices();
		choice.insertAfter.enabled = false;
		choice.format.format = "{{CURSOR}}";
		let targetPath = path;
		if (mode === "editor") {
			choice.activeFileWritePosition = "cursor";
		} else if (mode === "canvas") {
			targetPath = await seedVaultFile(obsidian, sandbox, "marker-only.canvas", JSON.stringify({
				nodes: [{ id: "card", type: "text", text: "Original", x: 0, y: 0, width: 300, height: 200 }],
				edges: [],
			}));
			choice.captureTo = targetPath;
			choice.captureToActiveFile = false;
			choice.captureToCanvasNodeId = "card";
		} else {
			choice.activeFileWritePosition = "bottom";
		}
		await saveAndOpen(choice, path);
		const before = await obsidian.dev.evalJsonAsync<string>(`(async () => app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(targetPath)})))()`);
		await clearNotices();
		expect(await run(choice)).toMatchObject({ file: targetPath, effect: "unchanged" });
		await expectOneNothingToCaptureNotice();
		const after = await obsidian.dev.evalJsonAsync<string>(`(async () => app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(targetPath)})))()`);
		expect(after).toBe(before);
		expect(after).not.toMatch(/{{CURSOR}}/i);
	});

	it("keeps markers from an included template in Capture scope", async () => {
		const { choice, path } = await setup();
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "snippet.md", "before{{CURSOR}}after");
		choice.format.format = `{{TEMPLATE:${template}}}`;
		await saveAndOpen(choice, path);
		await run(choice);
		const result = await state(path);
		expect(result.content).toContain("after\nExisting\n");
		expect(result.editorContent.slice(result.offset)).toBe("after\nExisting\n");
		expect(result.content).not.toContain("{{CURSOR}}");
	});

	it("refreshes cursor autocomplete when switching between body and property capture", async () => {
		const { choice, path } = await setup();
		const { obsidian } = getContext();
		choice.format.format = "{{CUR";
		await saveAndOpen(choice, path);
		await closeCaptureBuilders();
		await obsidian.dev.evalJson(`(() => {
			app.setting.open(); app.setting.openTabById("quickadd"); return true;
		})()`);
		try {
			const configure = `[aria-label="Configure ${choice.name}"]`;
			await expect.poll(() => obsidian.dev.evalJson(`(() =>
				[...document.querySelectorAll(${JSON.stringify(configure)})]
					.some(button => button.getClientRects().length > 0)
			)()`), AUTOSAVE_POLL).toBe(true);
			expect(await obsidian.dev.evalJson(`(() => {
				const button = [...document.querySelectorAll(${JSON.stringify(configure)})]
					.find(button => button.getClientRects().length > 0);
				button?.click();
				return Boolean(button);
			})()`)).toBe(true);
			await expect.poll(() => obsidian.dev.evalJson(`(() =>
				[...document.querySelectorAll(".captureChoiceBuilder")]
					.filter(builder => builder.getClientRects().length > 0).length
			)()`), AUTOSAVE_POLL).toBe(1);
			for (const position of ["after", "property", "top"]) {
				expect(await withLatestCaptureBuilder<boolean>(`(() => {
					const row = [...builder.querySelectorAll(".setting-item")].find(el => el.querySelector(".setting-item-name")?.textContent === "Write position");
					const select = row?.querySelector("select");
					if (!(select instanceof HTMLSelectElement)) return false;
					select.value = ${JSON.stringify(position)};
					select.dispatchEvent(new Event("change", { bubbles: true }));
					return true;
				})()`)).toBe(true);
				await expect.poll(() => withLatestCaptureBuilder<string | null>(`(() => {
					const input = builder.querySelector('textarea[placeholder="Format"], textarea[placeholder="One item per line"]');
					return input instanceof HTMLTextAreaElement ? input.value : null;
				})()`), AUTOSAVE_POLL).toBe("{{CUR");
				await typeIntoLatestCaptureFormat("{{CUR");
				await expect.poll(() => obsidian.dev.evalJson(`(() =>
					[...document.querySelectorAll(".suggestion-item")]
						.filter(el => el.getClientRects().length && el.textContent?.startsWith("{{CURSOR}}")).length
				)()`), AUTOSAVE_POLL).toBe(position === "property" ? 0 : 1);
			}
		} finally {
			await closeCaptureBuilders();
		}
	});
});
