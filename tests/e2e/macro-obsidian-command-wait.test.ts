import { afterEach, beforeEach, expect, it } from "vitest";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, POLL_OPTS } from "./uiHelpers";

// An Obsidian command step waits for the promise the command returns, so the
// Macro page's first macro (#2067) moves the cursor in the daily note it just
// opened, with no Wait step. A command that never settles holds the macro up
// for at most the wait limit.
const getContext = createQuickAddE2EHarness("macro-obsidian-command-wait");

interface DailyNotesState { enabled: boolean; options: unknown }
let original: DailyNotesState;

const dailyNotes = (state?: DailyNotesState) => getContext().obsidian.dev.evalJsonAsync<DailyNotesState>(`(async () => {
	const plugin = app.internalPlugins.getPluginById("daily-notes");
	const state = ${JSON.stringify(state ?? null)};
	if (state) {
		if (state.enabled && !plugin.enabled) await plugin.enable(true);
		if (!state.enabled && plugin.enabled) await plugin.disable(true);
		plugin.instance.options = state.options;
	}
	return { enabled: plugin.enabled, options: plugin.instance.options };
})()`);

beforeEach(async () => { original = await dailyNotes(); });
afterEach(async () => { await dailyNotes(original); });

async function seedMacro(id: string, commands: unknown[]) {
	const { plugin } = getContext();
	await plugin.data<{ choices: unknown[] }>().patch((data) => {
		data.choices = [{ id, name: id, type: "Macro", command: false, macro: { id: `${id}-macro`, name: id, commands } }];
	});
	await plugin.reload({ waitUntilReady: true });
}

it.each([
	["an existing daily note", "# Today\n\n- first\n- second"],
	["a daily note created from its template", null],
])("opens %s and moves the cursor to its end without a Wait step", async (_label, existing) => {
	const { obsidian, sandbox } = getContext();
	const template = await seedVaultFile(obsidian, sandbox, "Daily template.md", "## Log\n- started");
	const other = await seedVaultFile(obsidian, sandbox, "Other.md", "line one\nline two\nline three");
	const folder = sandbox.path("Journal");
	await dailyNotes({ enabled: true, options: { folder, format: "YYYY-MM-DD", template: template.replace(/\.md$/, "") } });
	const today = await obsidian.dev.evalJson<string>(`window.moment().format("YYYY-MM-DD")`);
	if (existing) await seedVaultFile(obsidian, sandbox, `Journal/${today}.md`, existing);
	else await obsidian.dev.evalJsonAsync(`(async () => {
		const note = app.vault.getAbstractFileByPath(${jsLiteral(`${folder}/${today}.md`)});
		if (note) await app.vault.delete(note);
		return true;
	})()`);
	await seedMacro("qa-e2e-first-macro", [
		{ id: "open", name: "Daily notes: Open today's daily note", type: "Obsidian", commandId: "daily-notes" },
		{ id: "end", name: "Move cursor to file end", type: "EditorCommand", editorCommandType: "Move cursor to file end" },
	]);
	// Start where the issue did: another note open, its cursor mid-file.
	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(other)}));
		app.workspace.setActiveLeaf(leaf, { focus: true });
		leaf.view.editor.setCursor({ line: 1, ch: 4 });
		return true;
	})()`);

	await expect(obsidian.execJson("quickadd:run", { id: "qa-e2e-first-macro" })).resolves.toMatchObject({ ok: true });

	const state = await obsidian.dev.evalJson(`(() => {
		const editor = app.workspace.activeEditor.editor;
		const last = editor.lastLine();
		return { file: app.workspace.getActiveFile().path, cursor: editor.getCursor(), end: { line: last, ch: editor.getLine(last).length } };
	})()`);
	const end = existing ? { line: 3, ch: 8 } : { line: 1, ch: 9 };
	expect(state).toEqual({ file: `${folder}/${today}.md`, cursor: end, end });
});

it("continues a macro past a command that never settles, and says why", async () => {
	const { obsidian, sandbox } = getContext();
	const marker = sandbox.path("after-never.md");
	const script = await seedVaultFile(obsidian, sandbox, "after-never.js",
		`module.exports = async ({ app }) => { await app.vault.create(${jsLiteral(marker)}, "ran"); };`);
	await obsidian.dev.evalJson(`(() => {
		app.commands.addCommand({ id: "qa-e2e:never-settles", name: "Never settles", callback: () => new Promise(() => {}) });
		return true;
	})()`);
	try {
		await seedMacro("qa-e2e-never-settles", [
			{ id: "never", name: "Never settles", type: "Obsidian", commandId: "qa-e2e:never-settles" },
			{ id: "after", name: "after", type: "UserScript", path: script, settings: {} },
		]);

		const started = Date.now();
		await expect(obsidian.execJson("quickadd:run", { id: "qa-e2e-never-settles" })).resolves.toMatchObject({ ok: true });
		const elapsed = Date.now() - started;

		await expect.poll(() => sandbox.read("after-never.md").catch(() => ""), POLL_OPTS).toBe("ran");
		expect(elapsed).toBeGreaterThanOrEqual(5000);
		expect(elapsed).toBeLessThan(15000);
		await expect.poll(() => obsidian.dev.evalJson<string[]>(
			`[...document.querySelectorAll(".notice")].map((n) => n.textContent)`,
		), POLL_OPTS).toContainEqual(expect.stringContaining(
			"Obsidian command 'Never settles' was still running after 5 seconds. QuickAdd continued the macro without waiting for it.",
		));
	} finally {
		await obsidian.dev.evalJson(`(() => { app.commands.removeCommand("qa-e2e:never-settles"); return true; })()`);
	}
});
