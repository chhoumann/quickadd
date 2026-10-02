import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { clickWhenStill, insertText, jsLiteral, leaveSettingsPage, POLL_OPTS, pressKey, quickCommandBarOverflow, typeInto } from "./uiHelpers";

// A choice's settings open as a page of Settings → QuickAdd, like the AI
// Assistant's pages, instead of a dialog over the settings window. Leaving the
// page saves it.
const getContext = createQuickAddE2EHarness("choice-builder-pages");

type Data = { choices: IChoice[] };

afterEach(async () => {
	await getContext().obsidian.dev.evalJson("app.setting.close(), true");
});

function capture(name: string, id: string): CaptureChoice {
	const choice = new CaptureChoice(name);
	choice.id = id;
	choice.captureTo = `${id}.md`;
	return choice;
}

async function seed(...choices: IChoice[]) {
	const { plugin } = getContext();
	await plugin.data<Data>().patch((data) => {
		data.choices = choices;
	});
	await plugin.reload({ waitUntilReady: true });
}

const click = (selector: string) => clickWhenStill(getContext().obsidian, selector);

async function openSettings() {
	await getContext().obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
}

/** The Then commands the stored macro's Conditional holds. */
async function storedThenCommands(): Promise<unknown[] | undefined> {
	const command = (await storedMacro())?.macro.commands.find((c) => c.id === "pages-if");
	return (command as unknown as { thenCommands?: unknown[] } | undefined)?.thenCommands;
}

/** The titles on Obsidian's settings page stack, bottom first. */
const pageTitles = () =>
	getContext().obsidian.dev.evalJson<string[]>("app.setting.pageStack.map((entry) => entry.page.title)");

/** Select the Name field on the page that is showing and type `name`. */
async function rename(name: string) {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`(() => {
		const input = [...document.querySelectorAll(".qa-builder-page")].pop().querySelector(".setting-group input");
		input.focus();
		input.select();
		return true;
	})()`);
	await insertText(obsidian, name);
}

const stored = (id: string) =>
	getContext().obsidian.dev.evalJson<IChoice | null>(
		`app.plugins.plugins.quickadd.settings.choices.find((c) => c.id === ${jsLiteral(id)}) ?? null`,
	);

const onDisk = async (id: string) =>
	(await getContext().plugin.data<Data>().read()).choices.find((c) => c.id === id) ?? null;

it("opens a choice's settings as a page in the settings window, and saves it when left with back", async () => {
	const { obsidian } = getContext();
	await seed(capture("Inbox", "pages-inbox"));
	await openSettings();
	await click('[aria-label="Configure Inbox"]');

	await expect.poll(pageTitles, POLL_OPTS).toEqual(["Inbox"]);
	// A page of the settings window, not a dialog over it.
	expect(await obsidian.dev.evalJson<[number, boolean]>(
		'[document.querySelectorAll(".modal-container").length, Boolean(document.querySelector(".modal.mod-settings .qa-builder-page"))]',
	)).toEqual([1, true]);

	await rename("Inbox (work)");
	// The title bar follows the name as it is typed.
	expect(await obsidian.dev.evalJson<string>(
		'document.querySelector(".qa-builder-page .setting-page-title").textContent',
	)).toBe("Inbox (work)");
	expect((await stored("pages-inbox"))?.name).toBe("Inbox");

	await leaveSettingsPage(obsidian);
	expect((await stored("pages-inbox"))?.name).toBe("Inbox (work)");
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(\'[aria-label="Configure Inbox (work)"]\'))',
	), POLL_OPTS).toBe(true);
	await expect.poll(async () => (await onDisk("pages-inbox"))?.name, POLL_OPTS).toBe("Inbox (work)");
});

it("leaves the page on Escape, and saves it", async () => {
	await seed(capture("Inbox", "pages-inbox"));
	await openSettings();
	await click('[aria-label="Configure Inbox"]');
	await expect.poll(pageTitles, POLL_OPTS).toEqual(["Inbox"]);
	await rename("Inbox (esc)");

	// The first Escape leaves the field for its row, the next leaves the page.
	const { obsidian } = getContext();
	await pressKey(obsidian, "Escape");
	await pressKey(obsidian, "Escape");
	await expect.poll(pageTitles, POLL_OPTS).toEqual([]);
	expect((await stored("pages-inbox"))?.name).toBe("Inbox (esc)");
});

it("saves the open page when settings is closed with its close button", async () => {
	await seed(capture("Inbox", "pages-inbox"));
	await openSettings();
	await click('[aria-label="Configure Inbox"]');
	await rename("Inbox (closed)");

	await click(".modal.mod-settings > .modal-header-button");
	await expect.poll(() => getContext().obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(".modal.mod-settings"))',
	), POLL_OPTS).toBe(false);
	expect((await stored("pages-inbox"))?.name).toBe("Inbox (closed)");
});

function macroWithBranchAndStep(): IMacroChoice {
	const macro = new MacroChoice("Morning");
	macro.id = "pages-macro";
	const step = capture("Log", "pages-step");
	macro.macro.commands = [
		{ id: "pages-step-command", name: "Log", type: "NestedChoice", choice: step },
		{
			id: "pages-if",
			name: "If",
			type: "Conditional",
			condition: { mode: "variable", variableName: "mood", operator: "isTruthy", valueType: "string" },
			thenCommands: [],
			elseCommands: [],
		},
	] as unknown as IMacroChoice["macro"]["commands"];
	return macro;
}

const storedMacro = async () => (await stored("pages-macro")) as IMacroChoice | null;

it("opens a macro's branch and Choice step as pages over it, and back returns to the macro", async () => {
	const { obsidian } = getContext();
	await seed(macroWithBranchAndStep());
	await openSettings();
	await click('[aria-label="Configure Morning"]');
	await expect.poll(pageTitles, POLL_OPTS).toEqual(["Morning"]);

	await click('.macroBuilder [aria-label^="Edit then branch"]');
	await expect.poll(pageTitles, POLL_OPTS).toEqual(["Morning", "Then: $mood is truthy"]);
	// With no steps above it, the quick-command bar keeps its card's padding (#2145).
	expect(await quickCommandBarOverflow(obsidian)).toEqual([]);
	await click('.conditionalBranchPage [aria-label="Add wait command"]');
	await leaveSettingsPage(obsidian);
	expect(await obsidian.dev.evalJson<string>(
		'document.querySelector(".macroBuilder .conditionalBranches").textContent',
	)).toContain("Then: 1");

	await click('.macroBuilder [aria-label="Configure Log"]');
	await expect.poll(pageTitles, POLL_OPTS).toEqual(["Morning", "Log"]);
	await rename("Log to journal");
	await leaveSettingsPage(obsidian);
	expect(await obsidian.dev.evalJson<string[]>(
		'[...document.querySelectorAll(".macroBuilder .quickAddCommandLabel")].map((el) => el.textContent.trim())',
	)).toContain("Log to journal");

	// Nothing is saved until the macro itself is left.
	expect(await storedThenCommands()).toEqual([]);
	await leaveSettingsPage(obsidian);
	const saved = (await storedMacro())?.macro.commands;
	expect(saved?.find((c) => c.id === "pages-step-command")).toMatchObject({
		name: "Log to journal",
		choice: { name: "Log to journal" },
	});
	expect(await storedThenCommands()).toHaveLength(1);
});

/** The aria-label of what has focus, once Obsidian and QuickAdd are done placing it. */
const focusedLabel = () =>
	getContext().obsidian.dev.evalJson<string | null>('document.activeElement?.getAttribute("aria-label") ?? null');

/** Focus `selector` and open it with Enter, as a keyboard user does, then leave the page with Escape. */
async function openAndLeaveWithKeyboard(selector: string, title: string) {
	const { obsidian } = getContext();
	const depth = (await pageTitles()).length;
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const el = [...document.querySelectorAll(${jsLiteral(selector)})].pop();
		el?.focus();
		return document.activeElement === el;
	})()`)).toBe(true);
	await pressKey(obsidian, "Enter");
	await expect.poll(async () => (await pageTitles()).at(-1), POLL_OPTS).toBe(title);
	await pressKey(obsidian, "Escape");
	await expect.poll(async () => (await pageTitles()).length, POLL_OPTS).toBe(depth);
}

it("comes back from a page where it was: the filter kept and focus on the control that opened it (#2150)", async () => {
	const { obsidian } = getContext();
	await seed(capture("Inbox", "pages-inbox"), capture("Journal", "pages-journal"), macroWithBranchAndStep());
	await openSettings();

	await typeInto(obsidian, 'input[placeholder="Filter choices..."]', "Jour");
	await openAndLeaveWithKeyboard('[aria-label="Configure Journal"]', "Journal");
	expect(await obsidian.dev.evalJson<string>(
		'document.querySelector(\'input[placeholder="Filter choices..."]\').value',
	)).toBe("Jour");
	await expect.poll(focusedLabel, POLL_OPTS).toBe("Configure Journal");

	// New choice opens the new choice's page; back returns to the button.
	await click(".qaFilterClearButton");
	await click(".qaNewChoiceBtn.mod-cta");
	await click(".menu-item");
	await expect.poll(async () => (await pageTitles()).length, POLL_OPTS).toBe(1);
	await pressKey(obsidian, "Escape");
	await expect.poll(pageTitles, POLL_OPTS).toEqual([]);
	await expect.poll(focusedLabel, POLL_OPTS).toBe("New choice");

	// Nested pages return to the macro's button that opened them.
	await openAndLeaveWithKeyboard('[aria-label="Configure Morning"]', "Morning");
	await expect.poll(focusedLabel, POLL_OPTS).toBe("Configure Morning");
	await pressKey(obsidian, "Enter");
	await expect.poll(pageTitles, POLL_OPTS).toEqual(["Morning"]);
	await openAndLeaveWithKeyboard('.macroBuilder [aria-label^="Edit then branch"]', "Then: $mood is truthy");
	await expect.poll(focusedLabel, POLL_OPTS).toBe("Edit then branch for $mood is truthy");
	await openAndLeaveWithKeyboard('.macroBuilder [aria-label="Configure Log"]', "Log");
	await expect.poll(focusedLabel, POLL_OPTS).toBe("Configure Log");
});

it("comes back to New choice after adding the first choice (#2150)", async () => {
	const { obsidian } = getContext();
	await seed();
	await openSettings();
	// The empty list has its own New choice, replaced by the list's once a choice exists.
	await click(".choiceEmptyActions .qaNewChoiceBtn");
	await click(".menu-item");
	await expect.poll(async () => (await pageTitles()).length, POLL_OPTS).toBe(1);
	await pressKey(obsidian, "Escape");
	await expect.poll(pageTitles, POLL_OPTS).toEqual([]);
	await expect.poll(focusedLabel, POLL_OPTS).toBe("New choice");
});

it("saves a nested page into its macro when settings is closed over both", async () => {
	await seed(macroWithBranchAndStep());
	await openSettings();
	await click('[aria-label="Configure Morning"]');
	await click('.macroBuilder [aria-label^="Edit then branch"]');
	await click('.conditionalBranchPage [aria-label="Add wait command"]');

	await getContext().obsidian.dev.evalJson("app.setting.close(), true");
	expect(await storedThenCommands()).toHaveLength(1);
});

it("keeps what another device changed while the page was open", async () => {
	const { obsidian, plugin } = getContext();
	await seed(capture("Inbox", "pages-inbox"), capture("Journal", "pages-journal"));
	await openSettings();
	await click('[aria-label="Configure Inbox"]');
	await rename("Inbox (here)");

	// Another device changes this choice's target and renames the other choice.
	await plugin.data<Data>().patch((data) => {
		data.choices = data.choices.map((c) =>
			c.id === "pages-inbox" ? { ...c, captureTo: "Phone.md" } as IChoice
				: c.id === "pages-journal" ? { ...c, name: "Journal (phone)" } : c);
	});
	await expect.poll(async () => (await stored("pages-journal"))?.name, POLL_OPTS).toBe("Journal (phone)");

	await leaveSettingsPage(obsidian);
	await expect.poll(() => onDisk("pages-inbox"), POLL_OPTS)
		.toMatchObject({ name: "Inbox (here)", captureTo: "Phone.md" });
	expect((await onDisk("pages-journal"))?.name).toBe("Journal (phone)");
});

it("says once that a choice deleted elsewhere was not saved, and does not bring it back", async () => {
	const { obsidian, plugin } = getContext();
	await seed(capture("Inbox", "pages-inbox"), capture("Journal", "pages-journal"));
	await openSettings();
	await click('[aria-label="Configure Inbox"]');
	await rename("Inbox (here)");
	await obsidian.dev.evalJson(`(() => {
		window.__qaNotices = [];
		window.__qaNoticeObserver = new MutationObserver((records) => {
			for (const record of records) for (const node of record.addedNodes) {
				if (node.classList?.contains("notice")) window.__qaNotices.push(node.textContent);
			}
		});
		window.__qaNoticeObserver.observe(document.body, { childList: true, subtree: true });
		return true;
	})()`);

	await plugin.data<Data>().patch((data) => {
		data.choices = data.choices.filter((c) => c.id !== "pages-inbox");
	});
	await expect.poll(() => stored("pages-inbox"), POLL_OPTS).toBeNull();

	// The app goes to the background twice, then the page is left.
	await goToBackground();
	await goToBackground();
	await leaveSettingsPage(obsidian);

	const notices = await obsidian.dev.evalJson<string[]>(
		"(() => { window.__qaNoticeObserver.disconnect(); return window.__qaNotices; })()",
	);
	expect(notices.filter((text) => text.includes("was deleted elsewhere"))).toEqual([
		"QuickAdd: “Inbox” was deleted elsewhere, so your changes to it were not saved.",
	]);
	expect(await stored("pages-inbox")).toBeNull();
	await expect.poll(async () => (await plugin.data<Data>().read()).choices.map((c) => c.id), POLL_OPTS)
		.toEqual(["pages-journal"]);
});

/** The document becomes hidden, as when a phone app goes to the background. */
async function goToBackground() {
	await getContext().obsidian.dev.evalJson(`(() => {
		Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
		document.dispatchEvent(new Event("visibilitychange"));
		delete document.visibilityState;
		return true;
	})()`);
}

it("saves the open page to disk when the app goes to the background, and leaves it open", async () => {
	const { obsidian } = getContext();
	await seed(capture("Inbox", "pages-inbox"));
	await openSettings();
	await click('[aria-label="Configure Inbox"]');
	await rename("Inbox (checkpoint)");

	await goToBackground();
	await expect.poll(async () => (await onDisk("pages-inbox"))?.name, POLL_OPTS).toBe("Inbox (checkpoint)");
	expect(await pageTitles()).toEqual(["Inbox (checkpoint)"]);

	// Back in the app, an edit after the checkpoint is saved on leaving too,
	// including going back to the old name.
	await rename("Inbox");
	await leaveSettingsPage(obsidian);
	await expect.poll(async () => (await onDisk("pages-inbox"))?.name, POLL_OPTS).toBe("Inbox");
});

it("saves a folder typed without Add when the app goes to the background (#1993)", async () => {
	const { obsidian, sandbox } = getContext();
	const template = new TemplateChoice("Book");
	template.id = "pages-template";
	template.folder = { ...template.folder, enabled: true, folders: [] };
	await seed(template);
	await openSettings();
	await click('[aria-label="Configure Book"]');
	const folder = sandbox.path("Books");
	await typeInto(obsidian, ".templateChoiceBuilder .qa-folder-path-input", folder);

	await goToBackground();
	await expect.poll(async () => ((await onDisk("pages-template")) as TemplateChoice | null)?.folder.folders, POLL_OPTS)
		.toEqual([folder]);
	// The page stays open, with the folder moved from the field into its list.
	expect(await pageTitles()).toEqual(["Book"]);
	expect(await obsidian.dev.evalJson<string>(
		'document.querySelector(".templateChoiceBuilder .qa-folder-path-input").value',
	)).toBe("");
});

it("saves the open page when QuickAdd reloads, without errors or later writes", async () => {
	const { obsidian, plugin } = getContext();
	await seed(capture("Inbox", "pages-inbox"));
	await obsidian.exec("dev:errors", { clear: true });
	await openSettings();
	await click('[aria-label="Configure Inbox"]');
	await rename("Inbox (reloaded)");

	await plugin.reload({ waitUntilReady: true });
	expect(await pageTitles()).toEqual([]);
	await expect.poll(async () => (await onDisk("pages-inbox"))?.name, POLL_OPTS).toBe("Inbox (reloaded)");
	expect((await stored("pages-inbox"))?.name).toBe("Inbox (reloaded)");
	expect((await obsidian.execText("dev:errors")).trim()).toBe("No errors captured.");
});
