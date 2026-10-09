import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { setVaultConfig } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("daily-note-token");

interface DailyNotesState { enabled: boolean; options: unknown }
let original: DailyNotesState;

async function setDailyNotes(state: DailyNotesState): Promise<void> {
	const { obsidian } = getContext();
	await obsidian.dev.evalJsonAsync(`(async () => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		const state = ${JSON.stringify(state)};
		if (state.enabled && !plugin.enabled) await plugin.enable(true);
		if (!state.enabled && plugin.enabled) await plugin.disable(true);
		plugin.instance.options = state.options;
		return true;
	})()`);
}

beforeEach(async () => {
	const { obsidian } = getContext();
	original = await obsidian.dev.evalJson<DailyNotesState>(`(() => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		return { enabled: plugin.enabled, options: plugin.instance.options };
	})()`);
});

afterEach(async () => {
	await setDailyNotes(original);
});

async function saveChoice(choice: CaptureChoice, globalVariables: Record<string, string> = {}) {
	const { plugin } = getContext();
	await plugin.data<{ choices: IChoice[]; globalVariables: Record<string, string> }>().patch((data) => {
		data.choices.push(choice);
		data.globalVariables = { ...data.globalVariables, ...globalVariables };
	});
	await plugin.reload({ waitUntilReady: true });
}

function dailyCapture(): CaptureChoice {
	const choice = new CaptureChoice("Daily note token E2E");
	choice.captureTo = "{{DAILY}}";
	choice.onePageInput = "never";
	choice.createFileIfItDoesntExist.enabled = true;
	choice.format = { enabled: true, format: "- {{VALUE}}\\n" };
	choice.insertAfter.enabled = true;
	choice.insertAfter.after = "## Log";
	choice.insertAfter.insertAtEnd = true;
	return choice;
}

async function read(path: string): Promise<string | null> {
	const { obsidian } = getContext();
	return obsidian.dev.evalJsonAsync<string | null>(`(async () => {
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
		return file ? app.vault.read(file) : null;
	})()`);
}

describe("{{DAILY}} in native Obsidian", () => {
	it("captures into the note Daily notes opens, created from its template the way Obsidian fills it", async () => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "Daily template.md", "# {{title}}\n\nOpened {{date:YYYY}} {{VALUE}}\n\n## Log\n");
		const folder = sandbox.path("Journal");
		await setDailyNotes({ enabled: true, options: { folder, format: "YYYY/YYYY-MM-DD", template: template.replace(/\.md$/, "") } });
		const choice = dailyCapture();
		await saveChoice(choice);

		for (const value of ["first", "second"]) {
			const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, date: "2031-02-10", vars: JSON.stringify({ value }) });
			expect(outcome).toMatchObject({ ok: true, verified: true, file: `${folder}/2031/2031-02-10.md` });
		}

		const year = new Date().getFullYear();
		// Daily notes fills {{title}} with the whole formatted name and {{date:...}} with
		// today; QuickAdd's own {{VALUE}} is not applied to a Daily notes template.
		await expect.poll(() => read(`${folder}/2031/2031-02-10.md`), { timeout: 10000, interval: 100 })
			.toBe(`# 2031/2031-02-10\n\nOpened ${year} {{VALUE}}\n\n## Log\n- first\n- second\n`);
		const daily = (day: string) => `app.internalPlugins.getPluginById("daily-notes").instance.getDailyNote(window.moment("${day}"))`;
		expect(await obsidian.dev.evalJsonAsync<string>(`${daily("2031-02-10")}.then((f) => f.path)`)).toBe(`${folder}/2031/2031-02-10.md`);
		// The note Obsidian itself creates from the same template, for comparison.
		expect(await obsidian.dev.evalJsonAsync<string>(`${daily("2031-02-13")}.then((f) => app.vault.read(f))`))
			.toBe(`# 2031/2031-02-13\n\nOpened ${year} {{VALUE}}\n\n## Log\n`);
	});

	it("links to the daily note from a capture body with {{DAILY|link}}", async () => {
		const { obsidian, sandbox } = getContext();
		const folder = sandbox.path("Links");
		await setDailyNotes({ enabled: true, options: { folder, format: "YYYY-MM-DD", template: "" } });
		await seedVaultFile(obsidian, sandbox, "Links/2031-02-11.md", "");
		const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "");
		const choice = new CaptureChoice("Daily link E2E");
		choice.captureTo = inbox;
		choice.onePageInput = "never";
		choice.format = { enabled: true, format: "{{DAILY|link}} and {{DAILY|link}}" };
		await saveChoice(choice);

		for (const date of ["2031-02-11", "2031-02-12"]) {
			await obsidian.dev.evalJsonAsync(`app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(inbox)}), "").then(() => true)`);
			const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, date });
			expect(outcome).toMatchObject({ ok: true });
			// An existing note follows the link settings; a missing one keeps its path so the link creates it there.
			const expected = date === "2031-02-11" ? "[[2031-02-11]] and [[2031-02-11]]" : `[[${folder}/2031-02-12]] and [[${folder}/2031-02-12]]`;
			await expect.poll(() => read(inbox), { timeout: 10000, interval: 100 }).toBe(expected);
		}
	});

	it("stops with a clear error, writing nothing, when Daily notes is off", async () => {
		const { obsidian } = getContext();
		await setDailyNotes({ enabled: false, options: {} });
		const choice = dailyCapture();
		await saveChoice(choice);

		const files = () => obsidian.dev.evalJson<string[]>("app.vault.getFiles().map((f) => f.path).sort()");
		const before = await files();

		const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ value: "x" }) });

		expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("{{DAILY}} needs the Daily notes core plugin") });
		expect(await files()).toEqual(before);
	});

	it("captures into this week's Periodic Notes note, named from the week's start and filled from its template", async () => {
		const { obsidian, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, "Weekly template.md", "# {{title}}\nMonday {{monday:MMM D}}\n\n## Log\n");
		const folder = sandbox.path("Weeks");
		// QuickAdd only reads Periodic Notes' settings, so a stand-in with the 0.0.17 shape is enough here.
		await obsidian.dev.evalJson(`(() => {
			app.plugins.plugins["periodic-notes"] = { settings: {
				weekly: { enabled: true, folder: ${JSON.stringify(folder)}, format: "gggg.MM.[Wk]w", template: "Weekly template" },
				monthly: { enabled: false },
			} };
			return true;
		})()`);
		try {
			const choice = dailyCapture();
			choice.captureTo = "{{WEEKLY}}";
			await saveChoice(choice);

			// Thursday 1 June 2023: the week starts on Sunday 28 May.
			const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, date: "2023-06-01", vars: JSON.stringify({ value: "planned" }) });
			expect(outcome).toMatchObject({ ok: true, verified: true, effect: "created", file: `${folder}/2023.05.Wk22.md` });
			await expect.poll(() => read(`${folder}/2023.05.Wk22.md`), { timeout: 10000, interval: 100 })
				.toBe("# 2023.05.Wk22\nMonday May 29\n\n## Log\n- planned\n");

			const monthlyChoice = dailyCapture();
			monthlyChoice.captureTo = "{{MONTHLY}}";
			await saveChoice(monthlyChoice);
			const monthly = await obsidian.execJson("quickadd:run", { id: monthlyChoice.id, verify: true, vars: JSON.stringify({ value: "x" }) });
			expect(monthly).toMatchObject({ ok: false, error: expect.stringContaining("{{MONTHLY}} needs the Periodic Notes plugin with monthly notes turned on") });
		} finally {
			await obsidian.dev.evalJson(`(() => { delete app.plugins.plugins["periodic-notes"]; return true; })()`);
		}
	});

	it("creates the daily note from its template for a target a global snippet names, and for any time of day", async () => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "Snippet template.md", "# {{title}}\n\n## Log\n");
		const folder = sandbox.path("Snippet");
		await setDailyNotes({ enabled: true, options: { folder, format: "YYYY-MM-DD", template } });
		const choice = dailyCapture();
		choice.captureTo = "{{GLOBAL_VAR:Daily target}}";
		await saveChoice(choice, { "Daily target": "{{DAILY}}" });

		const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, date: "2031-02-14", vars: JSON.stringify({ value: "from a snippet" }) });
		expect(outcome).toMatchObject({ ok: true, effect: "created", file: `${folder}/2031-02-14.md` });
		await expect.poll(() => read(`${folder}/2031-02-14.md`), { timeout: 10000, interval: 100 })
			.toBe("# 2031-02-14\n\n## Log\n- from a snippet\n");

		// So does a template included into Capture to.
		const include = await seedVaultFile(obsidian, sandbox, "Target include.md", "{{DAILY}}");
		const included = dailyCapture();
		included.captureTo = `{{TEMPLATE:${include}}}`;
		await saveChoice(included);
		const viaInclude = await obsidian.execJson("quickadd:run", { id: included.id, verify: true, date: "2031-02-13", vars: JSON.stringify({ value: "from an include" }) });
		expect(viaInclude).toMatchObject({ ok: true, effect: "created", file: `${folder}/2031-02-13.md` });
		await expect.poll(() => read(`${folder}/2031-02-13.md`), { timeout: 10000, interval: 100 })
			.toBe("# 2031-02-13\n\n## Log\n- from an include\n");

		// A script's Date at 17:45 names the same day's note, which still gets the template.
		await obsidian.dev.evalJsonAsync(`app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(choice.name)}, { value: "late" }, { date: new Date(2031, 1, 15, 17, 45) }).then(() => true)`);
		await expect.poll(() => read(`${folder}/2031-02-15.md`), { timeout: 10000, interval: 100 })
			.toBe("# 2031-02-15\n\n## Log\n- late\n");
	});

	it("captures into the daily note even when a folder has the note's name", async () => {
		const { obsidian, sandbox } = getContext();
		const folder = sandbox.path("Years");
		await setDailyNotes({ enabled: true, options: { folder, format: "YYYY", template: "" } });
		await obsidian.dev.evalJsonAsync(`app.vault.createFolder(${JSON.stringify(`${folder}/2031`)}).then(() => true)`);
		const choice = dailyCapture();
		choice.insertAfter.enabled = false;
		await saveChoice(choice);

		const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, date: "2031-02-10", vars: JSON.stringify({ value: "not a folder pick" }) });

		expect(outcome).toMatchObject({ ok: true, effect: "created", file: `${folder}/2031.md` });
	});

	it("writes a capture's front matter into a new daily note's body, as into the same note that already exists", async () => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "Typed template.md", "---\ntype: daily\n---\n## Log\n");
		const folder = sandbox.path("Typed");
		await setDailyNotes({ enabled: true, options: { folder, format: "YYYY-MM-DD", template } });
		await seedVaultFile(obsidian, sandbox, "Typed/2031-02-16.md", "---\ntype: daily\n---\n## Log\n");
		const choice = dailyCapture();
		choice.format = { enabled: true, format: "---\ntags: {{VALUE:tags|multi}}\n---\n" };
		await saveChoice(choice);

		for (const date of ["2031-02-16", "2031-02-17"]) {
			const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, date, vars: JSON.stringify({ tags: ["work", "home"] }) });
			expect(outcome).toMatchObject({ ok: true });
		}

		const existing = await read(`${folder}/2031-02-16.md`);
		expect(existing).toContain("tags: work,home");
		await expect.poll(() => read(`${folder}/2031-02-17.md`), { timeout: 10000, interval: 100 }).toBe(existing);
	});

	it("links a missing daily note with parentheses in its folder so the link leads there", async () => {
		const { obsidian, sandbox } = getContext();
		const folder = sandbox.path("Days (2031)");
		await setDailyNotes({ enabled: true, options: { folder, format: "YYYY-MM-DD", template: "" } });
		await obsidian.dev.evalJsonAsync(`app.vault.createFolder(${JSON.stringify(folder)}).then(() => true)`);
		const inbox = await seedVaultFile(obsidian, sandbox, "Md inbox.md", "");
		const choice = new CaptureChoice("Daily markdown link E2E");
		choice.captureTo = inbox;
		choice.onePageInput = "never";
		choice.format = { enabled: true, format: "{{DAILY|link}}" };
		await saveChoice(choice);
		const useMarkdownLinks = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('useMarkdownLinks')");
		await obsidian.dev.evalJson(`${setVaultConfig("useMarkdownLinks", true)}, true`);
		try {
			await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, date: "2031-02-18" });
			await expect.poll(() => read(inbox), { timeout: 10000, interval: 100 })
				.toBe(`[2031-02-18](${encodeURI(folder).replace(/\(/g, "%28").replace(/\)/g, "%29")}/2031-02-18.md)`);
			// Following the rendered link creates the note in the daily notes folder.
			const opened = await obsidian.dev.evalJsonAsync<string>(`(async () => {
				const leaf = app.workspace.getLeaf(false);
				await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(inbox)}), { state: { mode: "preview" } });
				await new Promise((r) => setTimeout(r, 800));
				leaf.view.containerEl.querySelector(".markdown-preview-view a.internal-link").click();
				await new Promise((r) => setTimeout(r, 800));
				return app.workspace.getActiveFile()?.path;
			})()`);
			expect(opened).toBe(`${folder}/2031-02-18.md`);
		} finally {
			await obsidian.dev.evalJson(`${setVaultConfig("useMarkdownLinks", useMarkdownLinks === true)}, true`);
		}
	});

	it("creates this week's note from its template when a global snippet names it and the format writes .md", async () => {
		const { obsidian, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, "Weekly md template.md", "# {{title}}\n\n## Log\n");
		const folder = sandbox.path("Weeks md");
		await obsidian.dev.evalJson(`(() => {
			app.plugins.plugins["periodic-notes"] = { settings: {
				weekly: { enabled: true, folder: ${JSON.stringify(folder)}, format: "gggg.MM.[Wk]w[.md]", template: "Weekly md template" },
			} };
			return true;
		})()`);
		try {
			const choice = dailyCapture();
			choice.captureTo = "{{GLOBAL_VAR:This week}}";
			await saveChoice(choice, { "This week": "{{WEEKLY}}" });

			const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, date: "2023-06-01", vars: JSON.stringify({ value: "planned" }) });

			expect(outcome).toMatchObject({ ok: true, effect: "created", file: `${folder}/2023.05.Wk22.md` });
			// Periodic Notes fills {{title}} with the formatted name, extension included.
			await expect.poll(() => read(`${folder}/2023.05.Wk22.md`), { timeout: 10000, interval: 100 })
				.toBe("# 2023.05.Wk22.md\n\n## Log\n- planned\n");
		} finally {
			await obsidian.dev.evalJson(`(() => { delete app.plugins.plugins["periodic-notes"]; return true; })()`);
		}
	});
});
