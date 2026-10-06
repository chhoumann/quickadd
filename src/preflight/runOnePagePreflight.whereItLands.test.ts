import realMoment from "moment";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { ensureObsidianDomPolyfills } from "../../tests/helpers/preflight/modal";
import { headingCapture } from "../gui/choiceList/presets";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import type IChoice from "../types/choices/IChoice";
import { setQuickAddInstance } from "../quickAddInstance";
import { runOnePagePreflight } from "./runOnePagePreflight";

/**
 * The one-page form says where the run lands before it writes: the note a
 * Template creates, where a Capture adds to, and the dates it read from the
 * answers. Driven through the real form, as a user types into it.
 */

vi.mock("src/logger/logManager", () => ({
	log: { logWarning: vi.fn(), logError: vi.fn(), logMessage: vi.fn() },
}));
vi.mock("src/gui/date-picker/datePicker", () => ({
	createDatePicker: () => ({ setSelectedIso: vi.fn(), destroy: vi.fn() }),
	attachCalendarToggle: () => () => undefined,
}));
// The capture text field suggests links and tags and takes pasted images;
// none of that is used here.
vi.mock("src/gui/suggesters/fileSuggester", () => ({ FileSuggester: class { close() {} destroy() {} } }));
vi.mock("src/gui/suggesters/tagSuggester", () => ({ TagSuggester: class { close() {} destroy() {} } }));
vi.mock("src/gui/imagePasteHandler", () => ({
	attachImagePasteHandler: () => ({ isBusy: () => false, whenIdle: () => Promise.resolve(), detach: vi.fn() }),
}));
vi.mock("src/gui/promptPeek/stylePeekButton", () => ({
	applyCompactPromptChrome: vi.fn(),
	stylePeekButton: <T,>(button: T): T => button,
}));

const originalMoment = (window as unknown as { moment?: unknown }).moment;
beforeAll(() => {
	ensureObsidianDomPolyfills();
	realMoment.locale("en");
	(window as unknown as { moment: unknown }).moment = realMoment;
	// Tuesday. Only Date is faked: the form's preview pass awaits real timers.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-06T10:00:00"));
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	vi.useRealTimers();
});
afterEach(() => {
	document.body.replaceChildren();
});

const app = {
	workspace: { getActiveViewOfType: () => null, getActiveFile: () => null },
	vault: {
		getAbstractFileByPath: () => null,
		getMarkdownFiles: () => [],
		getRoot: () => ({ path: "/" }),
	},
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
	fileManager: { getNewFileParent: () => ({ path: "/" }) },
	plugins: { plugins: {} },
	internalPlugins: {
		plugins: {
			"daily-notes": { enabled: true, instance: { options: { folder: "Journal", format: "YYYY-MM-DD" } } },
		},
	},
} as unknown as App;

const plugin = {
	app,
	settings: { inputPrompt: "single-line", globalVariables: {}, useSelectionAsCaptureValue: false },
} as never;
setQuickAddInstance(plugin);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Opens the form for `choice`, and leaves it open. */
async function openForm(choice: IChoice): Promise<void> {
	void runOnePagePreflight(app, plugin, createChoiceExecutor(), choice).catch(() => undefined);
	await vi.waitFor(() => expect(document.querySelector(".qa-onepage-preview")).not.toBeNull());
	await settle();
}

async function type(label: string, text: string): Promise<void> {
	const name = [...document.querySelectorAll("[id^=qa-onepage-label-]")].find((el) => el.textContent === label);
	const input = name?.parentElement?.parentElement?.querySelector("input, textarea") as HTMLInputElement | null;
	if (!input) throw new Error(`No field labelled ${label}`);
	input.value = text;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	await settle();
}

function rows(): string[] {
	return [...document.querySelectorAll(".qa-onepage-preview-row")].map((row) =>
		`${row.querySelector(".qa-preview-key")?.textContent} ${row.querySelector(".qa-preview-val")?.textContent}`);
}

function meetingNote(fileName: string): TemplateChoice {
	const choice = new TemplateChoice("Meeting note");
	choice.templatePath = "Templates/Meeting.md";
	choice.fileNameFormat = { enabled: true, format: fileName };
	choice.folder = { ...choice.folder, enabled: true, folders: ["Meetings"] };
	return choice;
}

describe("the one-page form shows where the run lands", () => {
	it("shows the full path of the note a Template creates, as the answer is typed", async () => {
		await openForm(meetingNote("{{DATE}} {{VALUE:Topic}}"));
		await type("Topic", "Launch review");
		expect(rows()).toEqual(["Creates: Meetings/2026-10-06 Launch review.md"]);
	});

	it("names the folder the run will ask for", async () => {
		const choice = meetingNote("{{VALUE:Topic}}");
		choice.folder = { ...choice.folder, chooseWhenCreatingNote: true };
		await openForm(choice);
		await type("Topic", "Launch review");
		expect(rows()).toEqual(["Creates: {folder}/Launch review.md"]);
	});

	it("shows today's daily note and the heading a Capture adds under", async () => {
		const log = headingCapture("Log", "## Log");
		log.format = { enabled: true, format: "- {{VALUE}}" };
		await openForm(log);
		expect(rows()).toEqual(["Adds to: Journal/2026-10-06.md under ## Log"]);
	});

	it("says a Capture to a folder adds to a note you pick", async () => {
		const choice = new CaptureChoice("Inbox");
		choice.captureTo = "Inbox/";
		choice.format = { enabled: true, format: "- {{VALUE}}" };
		await openForm(choice);
		expect(rows()).toEqual(["Adds to: a note you pick"]);
	});

	it("says a Capture to the active file adds to the current note", async () => {
		const choice = new CaptureChoice("Here");
		choice.captureToActiveFile = true;
		choice.format = { enabled: true, format: "- {{VALUE}}" };
		await openForm(choice);
		expect(rows()).toEqual(["Adds to: the current note"]);
	});

	it("shows the date a VDATE answer parses to, in the token's format", async () => {
		await openForm(meetingNote("{{VDATE:When,YYYY-MM-DD}} {{VALUE:Topic}}"));
		await type("Topic", "Launch review");
		// On a Tuesday, the parser reads "next friday" as the one after this week's.
		await type("When", "next friday");
		expect(rows()).toEqual([
			"Creates: Meetings/2026-10-16 Launch review.md",
			"When: 2026-10-16",
		]);
	});

	it("says Not a date, in the error style, while the text does not parse", async () => {
		await openForm(meetingNote("{{VDATE:When,YYYY-MM-DD}} {{VALUE:Topic}}"));
		await type("When", "blah");
		expect(rows().at(-1)).toBe("When: Not a date");
		const value = [...document.querySelectorAll(".qa-preview-val")].at(-1);
		expect(value?.classList.contains("qa-preview-issue--error")).toBe(true);
	});
});
