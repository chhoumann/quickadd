import { afterEach, beforeEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { ActionNode } from "../../src/v3/model";
import { createQuickAddE2EHarness } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, insertText, jsLiteral, POLL_OPTS, pressKey, waitForElement, withoutFocusRing } from "./uiHelpers";

// A new user's empty list asks what they do in Obsidian and creates choices
// for the answer, built on what the vault has: daily notes when they are on,
// a dated note in Journal/ when they are not.
const getContext = createQuickAddE2EHarness("v3-first-run");

type Data = { choices: IChoice[]; actions: ActionNode[]; templateFolderPaths: string[] };
interface DailyNotesState { enabled: boolean; options: unknown }
let original: DailyNotesState;
let today: string;

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

/** An empty list, with QuickAdd's templates in the sandbox, and Settings open on it. */
async function openEmptyList(): Promise<void> {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [];
		data.templateFolderPaths = [sandbox.path("Templates")];
	}));
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
}

async function pick(...jobs: string[]): Promise<void> {
	const { obsidian } = getContext();
	for (const job of jobs) await clickWhenStill(obsidian, `.qaJobCard[data-job="${job}"]`);
}

function rows(): Promise<Array<[string, string]>> {
	return getContext().obsidian.dev.evalJson(`[...document.querySelectorAll("[data-choice-id]")]
		.map((row) => [row.querySelector(".choiceListItemName")?.textContent?.trim() ?? "", row.querySelector(".choiceListItemSummary")?.textContent ?? ""])`);
}

beforeEach(async () => {
	const { obsidian } = getContext();
	original = await obsidian.dev.evalJson<DailyNotesState>(`(() => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		return { enabled: plugin.enabled, options: plugin.instance.options };
	})()`);
	today = await obsidian.dev.evalJson<string>('window.moment().format("YYYY-MM-DD")');
});

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson("app.setting.close(), true");
	await setDailyNotes(original);
	// Journal/ is at the vault root, outside the sandbox.
	await obsidian.dev.evalJsonAsync(`(async () => {
		const folder = app.vault.getFolderByPath("Journal");
		if (folder) await app.vault.delete(folder, true);
		return true;
	})()`);
});

it("creates a journal and meeting notes from the answer, and Log writes to today's daily note", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const folder = sandbox.path("Daily");
	await setDailyNotes({ enabled: true, options: { folder, format: "YYYY-MM-DD", template: "" } });
	await openEmptyList();

	await pick("journal", "meetings");
	await clickWhenStill(obsidian, 'button.mod-cta.qaCreateChoicesBtn:not([disabled])');

	await expect.poll(rows, POLL_OPTS).toEqual([
		["Log", "Adds a line under ## Log in today's daily note"],
		["Thought", "Adds a line under ## Thoughts in today's daily note"],
		["Meeting note", "Creates Meetings/{date} {Topic} from Meeting, opens it"],
	]);
	await expect.poll(async () => (await plugin.data<Data>().read()).actions.map((node) => node.name), POLL_OPTS)
		.toEqual(["Log", "Thought", "Meeting note"]);
	expect(await sandbox.read("Templates/Meeting.md")).toContain("# Meeting with {{VALUE:Who}}");
	await obsidian.dev.evalJson("app.setting.close(), true");

	// From the command palette: Run QuickAdd, pick Log, answer its prompt.
	await obsidian.command("quickadd:runQuickAdd").run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.activeElement?.closest(".prompt"))'), POLL_OPTS).toBe(true);
	await insertText(obsidian, "Log");
	await obsidian.sleep(200);
	await pressKey(obsidian, "Enter");
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.activeElement?.closest(".modal-container"))'), POLL_OPTS).toBe(true);
	await insertText(obsidian, "Planted the tomatoes");
	await pressKey(obsidian, "Enter");

	await expect.poll(() => sandbox.read(`Daily/${today}.md`).catch(() => ""), POLL_OPTS)
		.toMatch(/^## Log\n- \d{2}:\d{2} Planted the tomatoes\n?$/);
});

it("writes tasks to a dated note in Journal/ when daily notes are off", async () => {
	const { obsidian } = getContext();
	await setDailyNotes({ enabled: false, options: {} });
	await openEmptyList();

	await pick("tasks");
	await clickWhenStill(obsidian, 'button.mod-cta.qaCreateChoicesBtn:not([disabled])');
	await expect.poll(rows, POLL_OPTS).toEqual([["Task", "Adds a task under ## Tasks in Journal/{date}"]]);
	await obsidian.dev.evalJson("app.setting.close(), true");

	const outcome = await obsidian.execJson("quickadd:run", {
		choice: "Task", verify: true, vars: JSON.stringify({ value: "Water the plants" }),
	});
	expect(outcome).toMatchObject({ ok: true, verified: true, file: `Journal/${today}.md` });
	const content = await obsidian.dev.evalJsonAsync<string>(
		`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(`Journal/${today}.md`)}))`,
	);
	expect(content).toMatch(/^## Tasks\n- \[ \] Water the plants\n?$/);
});

it("runs every first-run choice without an error notice", async () => {
	const { obsidian, sandbox } = getContext();
	await setDailyNotes({ enabled: true, options: { folder: sandbox.path("Daily"), format: "YYYY-MM-DD", template: "" } });
	await openEmptyList();
	await pick("journal", "tasks", "meetings", "reading", "projects");
	await clickWhenStill(obsidian, 'button.mod-cta.qaCreateChoicesBtn:not([disabled])');
	await expect.poll(async () => (await rows()).map(([name]) => name), POLL_OPTS)
		.toEqual(["Log", "Thought", "Task", "Meeting note", "Inbox", "Save link", "Project"]);
	await obsidian.dev.evalJson("app.setting.close(), true");
	// Project links the note it creates from the note that is open.
	const open = sandbox.path("Open.md");
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = await app.vault.create(${jsLiteral(open)}, "");
		await app.workspace.getLeaf(false).openFile(file);
		window.__qaNotices = [];
		window.__qaNoticeObserver = new MutationObserver((records) => {
			for (const record of records) for (const node of record.addedNodes) {
				if (node instanceof HTMLElement && node.matches(".notice")) window.__qaNotices.push(node);
			}
		});
		window.__qaNoticeObserver.observe(document.body, { childList: true, subtree: true });
		return true;
	})()`);
	try {
		const vars = JSON.stringify({ value: "First-run audit", Topic: "Audit", Who: "Ana", Name: "Audit project" });
		for (const choice of ["Log", "Thought", "Task", "Meeting note", "Inbox", "Save link", "Project"]) {
			expect(await obsidian.execJson("quickadd:run", { choice, verify: true, vars }), choice).toMatchObject({ ok: true });
		}
		const notices = await obsidian.dev.evalJson<string[]>("window.__qaNotices.map((n) => n.textContent)");
		expect(notices.filter((text) => text.includes("(ERROR)"))).toEqual([]);
	} finally {
		await obsidian.dev.evalJsonAsync(`(async () => {
			window.__qaNoticeObserver?.disconnect();
			delete window.__qaNotices;
			app.workspace.getLeaf(false).detach();
			for (const path of ["Inbox.md", "Reading list.md", "Meetings", "Projects"]) {
				const file = app.vault.getAbstractFileByPath(path);
				if (file) await app.vault.delete(file, true);
			}
			return true;
		})()`);
	}
});

it("refuses what is not set up in one sentence naming the choice, and shows nothing else", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await setDailyNotes({ enabled: true, options: { folder: sandbox.path("Daily"), format: "YYYY-MM-DD", template: "" } });
	await openEmptyList();
	await pick("journal", "meetings");
	await clickWhenStill(obsidian, 'button.mod-cta.qaCreateChoicesBtn:not([disabled])');
	await expect.poll(async () => (await rows()).map(([name]) => name), POLL_OPTS).toEqual(["Log", "Thought", "Meeting note"]);
	await obsidian.dev.evalJson("app.setting.close(), true");
	const quickCapture = new CaptureChoice("Quick capture");
	quickCapture.captureToActiveFile = true;
	const linkLog = new CaptureChoice("Link log");
	linkLog.captureTo = sandbox.path("Links.md");
	linkLog.createFileIfItDoesntExist.enabled = true;
	linkLog.format = { enabled: true, format: "- {{LINKCURRENT}}" };
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices.push(quickCapture, linkLog);
	}));
	await plugin.reload({ waitUntilReady: true });

	const notices = async () => obsidian.dev.evalJson<string[]>("window.__qaNotices.splice(0).map((n) => n.textContent)");
	const prompts = async () => obsidian.dev.evalJson<number>("window.__qaPrompts.splice(0).length");
	await obsidian.dev.evalJson(`(() => {
		window.__qaNotices = [];
		window.__qaPrompts = [];
		window.__qaNoticeObserver = new MutationObserver((records) => {
			for (const record of records) for (const node of record.addedNodes) {
				if (node instanceof HTMLElement && node.matches(".notice")) window.__qaNotices.push(node);
				if (node instanceof HTMLElement && node.matches(".modal-container, .prompt")) window.__qaPrompts.push(node);
			}
		});
		window.__qaNoticeObserver.observe(document.body, { childList: true, subtree: true });
		return true;
	})()`);
	const refuses = async (choice: string, sentence: string) => {
		expect(await obsidian.execJson("quickadd:run", { choice, verify: true, vars: JSON.stringify({ value: "x", Topic: "T", Who: "Ana" }) }), choice)
			.toMatchObject({ ok: false, error: sentence });
		await expect.poll(notices, POLL_OPTS).toEqual([sentence]);
	};
	try {
		await setDailyNotes({ enabled: false, options: {} });
		await refuses("Log", "Log: the Daily notes core plugin is off, so {{DAILY}} has no note to point at. Turn it on in Settings > Core plugins.");

		const template = sandbox.path("Templates/Meeting.md");
		await obsidian.dev.evalJsonAsync(`app.vault.delete(app.vault.getAbstractFileByPath(${jsLiteral(template)})).then(() => true)`);
		const missingTemplate = `Meeting note: the template ${template} does not exist, so no note was created. Pick a template on the choice's page.`;
		await refuses("Meeting note", missingTemplate);
		// Picked from the launcher, it says so before it asks for anything.
		await obsidian.command("quickadd:runQuickAdd").run();
		await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.activeElement?.closest(".prompt"))'), POLL_OPTS).toBe(true);
		await insertText(obsidian, "Meeting note");
		await obsidian.sleep(200);
		await prompts();
		await pressKey(obsidian, "Enter");
		await expect.poll(notices, POLL_OPTS).toEqual([missingTemplate]);
		await obsidian.sleep(500);
		expect(await prompts()).toBe(0);
		expect(await obsidian.dev.evalJson<number>('document.querySelectorAll(".modal-container, .prompt").length')).toBe(0);

		await obsidian.dev.evalJson("(() => { for (const leaf of app.workspace.getLeavesOfType('markdown')) leaf.detach(); return true; })()");
		await refuses("Quick capture", "Quick capture: no note is open, so there is nothing to add to.");
		await refuses("Link log", "Link log: no note is open, so {{LINKCURRENT}} has nothing to link to.");
	} finally {
		await obsidian.dev.evalJson("(() => { window.__qaNoticeObserver?.disconnect(); delete window.__qaNoticeObserver; delete window.__qaNotices; delete window.__qaPrompts; return true; })()");
	}
});

it("rings the card the keyboard is on, picked or not", async () => {
	const { obsidian } = getContext();
	await openEmptyList();
	await waitForElement(obsidian, ".qaJobCard");
	await pick("tasks");
	expect(await withoutFocusRing(obsidian, ".qaJobCard")).toEqual([]);
});
