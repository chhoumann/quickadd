import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

describe.runIf(process.env.OBSIDIAN_E2E_TEMPLATER === "1")("Template cursor with real Templater", () => {
	const getContext = createQuickAddE2EHarness("template-cursor-templater");

	beforeAll(async () => {
		expect(await getContext().obsidian.dev.evalJson(`(() => {
			const plugin = app.plugins.plugins["templater-obsidian"];
			return Boolean(plugin?.manifest?.id === "templater-obsidian" &&
				plugin.templater?.overwrite_file_commands && plugin.editor_handler);
		})()`)).toBe(true);
	});

	beforeEach(async () => {
		await getContext().obsidian.dev.evalJson(`(() => {
			const plugin = app.plugins.plugins["templater-obsidian"];
			window.__qaTemplaterCursorTest = {
				settings: structuredClone(plugin.settings),
				local: app.loadLocalStorage("templater-local-settings"),
				count: 0,
			};
			plugin.settings.auto_jump_to_cursor = true;
			plugin.settings.trigger_on_file_creation_mode = "none";
			app.saveLocalStorage("templater-local-settings", {
				...window.__qaTemplaterCursorTest.local, trigger_on_file_creation: false,
			});
			return true;
		})()`);
	});

	afterEach(async () => {
		const { obsidian, sandbox } = getContext();
		await obsidian.dev.evalJsonAsync(`(async () => {
			const probe = window.__qaTemplaterCursorTest;
			try {
				for (const leaf of app.workspace.getLeavesOfType("markdown")) {
					if (leaf.view.file?.path.startsWith(${JSON.stringify(sandbox.path(""))})) {
						await leaf.view.save();
						leaf.detach();
					}
				}
			} finally {
				if (probe) {
					app.plugins.plugins["templater-obsidian"].settings = probe.settings;
					app.saveLocalStorage("templater-local-settings", probe.local ?? null);
					delete window.__qaTemplaterCursorTest;
				}
			}
			return true;
		})()`);
	});

	async function setup(template: string) {
		const { obsidian, sandbox } = getContext();
		const choice = new TemplateChoice("Templater cursor");
		choice.onePageInput = "never";
		choice.templatePath = await seedVaultFile(obsidian, sandbox, `template-${choice.id}.md`, template);
		const filename = `result-${choice.id}`;
		const path = sandbox.path(`${filename}.md`);
		choice.fileNameFormat = { enabled: true, format: path.slice(0, -3) };
		choice.openFile = true;
		choice.fileOpening = { location: "tab", direction: "vertical", mode: "source", focus: true };
		choice.fileExistsBehavior = { kind: "apply", mode: "overwrite" };
		return { choice, path, filename };
	}

	async function save(choice: TemplateChoice) {
		const { plugin } = getContext();
		await plugin.data<{ choices: IChoice[] }>().patch(data => { data.choices.push(choice); });
		await plugin.reload({ waitUntilReady: true });
	}

	async function open(path: string) {
		await getContext().obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), { state: { mode: "source" } });
			app.workspace.setActiveLeaf(leaf, { focus: true });
			leaf.view.editor.setCursor({ line: 0, ch: 0 });
			leaf.view.editor.focus();
			return true;
		})()`);
	}

	async function run(choice: TemplateChoice) {
		const result = await getContext().obsidian.execJson("quickadd:run", { id: choice.id, verify: true });
		expect(result).toMatchObject({ ok: true, verified: true });
	}

	async function state(path: string) {
		return getContext().obsidian.dev.evalJsonAsync<{
			content: string; editor: string; active: string; tail: string;
		}>(`(async () => {
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
			const editor = app.workspace.activeLeaf?.view?.editor;
			return {
				content: file ? await app.vault.read(file) : "",
				editor: editor?.getValue() ?? "",
				active: app.workspace.getActiveFile()?.path ?? "",
				tail: editor ? editor.getValue().slice(editor.posToOffset(editor.getCursor())) : "",
			};
		})()`);
	}

	async function expectAt(path: string, content: string, tail: string) {
		await expect.poll(() => state(path), POLL_OPTS).toEqual({ content, editor: content, active: path, tail });
	}

	async function settleNativeCallback() {
		await getContext().obsidian.dev.evalJsonAsync("new Promise(resolve => setTimeout(() => resolve(true), 500))");
	}

	it.each(["create", "overwrite"])("expands title and date on both sides of the marker during %s", async mode => {
		const { choice, path, filename } = await setup('<% tp.file.title %> {{CURSOR}}<% tp.date.now("YYYY-MM-DD", 0, "2026-09-20", "YYYY-MM-DD") %>');
		if (mode === "overwrite") {
			const { obsidian, sandbox } = getContext();
			await seedVaultFile(obsidian, sandbox, `${filename}.md`, "Old note");
			await open(path);
		}
		await save(choice);
		await run(choice);
		await expectAt(path, `${filename} 2026-09-20`, "2026-09-20");
		await getContext().obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: "Typed " }) });
		await expect.poll(async () => (await state(path)).editor, POLL_OPTS).toBe(`${filename} Typed 2026-09-20`);
	});

	it("uses a marker introduced by a Templater include", async () => {
		const { obsidian, sandbox } = getContext();
		const child = await seedVaultFile(obsidian, sandbox, "included.md", "😀 before{{cursor}}after");
		const { choice, path } = await setup(`<% tp.file.include(${JSON.stringify(`[[${child}]]`)}) %>`);
		await save(choice);
		await run(choice);
		await expectAt(path, "😀 beforeafter", "after");
	});

	it.each([
		["overwrite", false],
		["overwrite", true],
		["appendTop", false],
		["appendTop", true],
		["appendBottom", false],
		["appendBottom", true],
	] as const)("lets native cursor 1 win and leaves cursor 2 for the next jump during %s with Open=%s", async (mode, openFile) => {
		const { choice, path, filename } = await setup("A<% tp.file.cursor( 1 ) %>B{{CURSOR}}C<% tp.file.cursor(2) %>D");
		const { obsidian, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, `${filename}.md`, "Old note");
		choice.fileExistsBehavior = { kind: "apply", mode };
		choice.openFile = openFile;
		await save(choice);
		await open(path);
		const originalLeafId = await obsidian.dev.evalJson<string>("app.workspace.activeLeaf.id");
		if (openFile) {
			expect(await obsidian.dev.evalJsonAsync(`(async () => {
				const first = app.workspace.activeLeaf;
				const second = app.workspace.getLeaf("tab");
				await second.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), { state: { mode: "source" } });
				second.view.editor.setCursor({ line: 0, ch: 3 });
				app.workspace.setActiveLeaf(first, { focus: true });
				first.view.editor.focus();
				const matching = [];
				app.workspace.iterateRootLeaves(leaf => {
					if (leaf.view.file?.path === ${JSON.stringify(path)}) matching.push(leaf);
				});
				return matching.length === 2 && matching[0] === first && matching[1] === second && app.workspace.activeLeaf === first;
			})()`)).toBe(true);
		}
		await run(choice);
		await settleNativeCallback();
		expect(await obsidian.dev.evalJson("app.workspace.activeLeaf.id")).toBe(originalLeafId);
		const prefix = mode === "appendBottom" ? "Old note\n" : "";
		const suffix = mode === "appendTop" ? "\nOld note" : "";
		await expectAt(path, `${prefix}ABC<% tp.file.cursor(2) %>D${suffix}`, `BC<% tp.file.cursor(2) %>D${suffix}`);
		await obsidian.exec("command", { id: "templater-obsidian:jump-to-next-cursor-location" });
		await expectAt(path, `${prefix}ABCD${suffix}`, `D${suffix}`);
	});

	it("uses the QuickAdd marker when Templater automatic jumping is disabled", async () => {
		const { choice, path } = await setup("A<% tp.file.cursor(1) %>B{{CURSOR}}C");
		await save(choice);
		await getContext().obsidian.dev.evalJson('app.plugins.plugins["templater-obsidian"].settings.auto_jump_to_cursor = false; true');
		await run(choice);
		await settleNativeCallback();
		await expectAt(path, "A<% tp.file.cursor(1) %>BC", "C");
	});

	it("executes only once with trigger on create enabled after the native callback", async () => {
		const { choice, path } = await setup('<%* window.__qaTemplaterCursorTest.count += 1; tR += "Before"; %>{{CURSOR}}after');
		await save(choice);
		await getContext().obsidian.dev.evalJson(`(() => {
			app.saveLocalStorage("templater-local-settings", {
				...app.loadLocalStorage("templater-local-settings"), trigger_on_file_creation: true,
			});
			return true;
		})()`);
		await run(choice);
		await settleNativeCallback();
		await expectAt(path, "Beforeafter", "after");
		expect(await getContext().obsidian.dev.evalJson("window.__qaTemplaterCursorTest.count")).toBe(1);
	});

	it("removes the QuickAdd marker even when Templater throws", async () => {
		const template = '<%* throw new Error("QA expected Templater failure"); %>Before{{CURSOR}}after';
		const { choice, path } = await setup(template);
		await save(choice);
		await getContext().obsidian.execJson("quickadd:run", { id: choice.id });
		await settleNativeCallback();
		await expect.poll(async () => (await state(path)).content, POLL_OPTS).toBe(template.replace("{{CURSOR}}", ""));
	});
});
