import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

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

async function saveChoice(choice: CaptureChoice) {
	const { plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch((data) => { data.choices.push(choice); });
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
});
