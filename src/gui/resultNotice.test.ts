import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, TFile, type App } from "obsidian";
import type { NoteWrite } from "../types/ChoiceOutcome";

type NoticeStub = { instances: { messageEl: HTMLElement }[] };

const { openChoiceFile } = vi.hoisted(() => ({ openChoiceFile: vi.fn(async () => true) }));
vi.mock("../engine/choiceFileActions", () => ({ openChoiceFile }));

const { resultNoticeText, showResultNotice } = await import("./resultNotice");

function note(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.basename = path.replace(/^.*\//, "").replace(/\.md$/, "");
	file.extension = "md";
	return file;
}

/** A vault holding one note, `notes/log.md`, with `content` (null: no note). */
function vault(content: string | null) {
	const file = note("notes/log.md");
	const state = { disk: content };
	const trashFile = vi.fn(async () => { state.disk = null; });
	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => path === file.path && state.disk !== null ? file : null,
			read: async () => state.disk ?? "",
			process: async (_file: TFile, fn: (content: string) => string) => (state.disk = fn(state.disk ?? "")),
		},
		workspace: { getActiveViewOfType: () => null, getLeavesOfType: () => [] },
		fileManager: { trashFile },
	} as unknown as App;
	return { app, file, state, trashFile };
}

function buttons(notice: Notice): HTMLButtonElement[] {
	return Array.from(notice.messageEl.querySelectorAll("button"));
}

function click(notice: Notice, label: string): void {
	const button = buttons(notice).find((el) => el.textContent === label);
	if (!button) throw new Error(`No ${label} button`);
	button.click();
}

const changed = (write: NoteWrite, file: TFile) => ({ file, effect: "changed" as const, write });

describe("result notice", () => {
	beforeEach(() => {
		openChoiceFile.mockClear();
		(Notice as unknown as NoticeStub).instances.length = 0;
	});

	it("says what the run did to which note", () => {
		const file = note("notes/log.md");
		expect(resultNoticeText("Log", "created", file)).toBe("Log: created 'log'");
		expect(resultNoticeText("Log", "changed", file)).toBe("Log: added to 'log'");
		expect(resultNoticeText("Log", "unchanged", file)).toBe("Log: nothing to add to 'log'");
	});

	it("offers Undo only when the run wrote", () => {
		const { app, file } = vault("# Log\n");
		expect(buttons(showResultNotice(app, "Log", { file, effect: "unchanged" })).map((b) => b.textContent))
			.toEqual(["Open"]);
		expect(buttons(showResultNotice(app, "Log", changed({ path: file.path, before: "", after: "# Log\n" }, file)))
			.map((b) => b.textContent)).toEqual(["Open", "Undo"]);
	});

	it("opens the note in the current tab", () => {
		const { app, file } = vault("# Log\n");
		click(showResultNotice(app, "Log", { file, effect: "unchanged" }), "Open");
		expect(openChoiceFile).toHaveBeenCalledWith(expect.objectContaining({ app, file, opening: { location: "reuse" } }));
	});

	it("puts back what the note held before the run", async () => {
		const { app, file, state } = vault("# Log\n- new\n");
		const notice = showResultNotice(app, "Log", changed({ path: file.path, before: "# Log\n", after: "# Log\n- new\n" }, file));
		click(notice, "Undo");
		await vi.waitFor(() => expect(notice.messageEl.textContent).toBe("Undone"));
		expect(state.disk).toBe("# Log\n");
		expect(openChoiceFile).not.toHaveBeenCalled();
	});

	it("moves a note the run created to the trash", async () => {
		const { app, file, trashFile } = vault("# New\n");
		const notice = showResultNotice(app, "New", { file, effect: "created", write: { path: file.path, before: null, after: "# New\n" } });
		click(notice, "Undo");
		await vi.waitFor(() => expect(notice.messageEl.textContent).toBe("Undone"));
		expect(trashFile).toHaveBeenCalledWith(file);
	});

	it("keeps a note changed since the run and opens it instead", async () => {
		const { app, file, state, trashFile } = vault("# Log\n- new\n- typed later\n");
		const notice = showResultNotice(app, "Log", changed({ path: file.path, before: "# Log\n", after: "# Log\n- new\n" }, file));
		click(notice, "Undo");
		await vi.waitFor(() => expect(notice.messageEl.textContent).toBe("Changed since, opened instead"));
		expect(state.disk).toBe("# Log\n- new\n- typed later\n");
		expect(trashFile).not.toHaveBeenCalled();
		expect(openChoiceFile).toHaveBeenCalledWith(expect.objectContaining({ file }));
	});
});
