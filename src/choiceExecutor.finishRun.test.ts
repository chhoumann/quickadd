import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, type TFile } from "obsidian";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import type IChoice from "./types/choices/IChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
import type { ICommand } from "./types/macros/ICommand";
import { CommandType } from "./types/macros/CommandType";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import { UserCancelError } from "./errors/UserCancelError";
import { runLog } from "./runLog";

type NoticeStub = { instances: { messageEl: HTMLElement }[] };

const { settings } = vi.hoisted(() => ({
	settings: { onePageInputEnabled: false, ai: {}, disableOnlineFeatures: true, showCaptureNotification: true },
}));

vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("./main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("./quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));
vi.mock("./settingsStore", () => ({ settingsStore: { getState: () => settings } }));
vi.mock("./utils/frontmatterPropertyLinks", () => ({
	getFocusedPropertyTarget: vi.fn(() => null),
}));
vi.mock("./utils/fileOpening", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getOpenFileOriginLeaf: vi.fn(() => null),
}));
// A Capture whose target says what it does: write, fail, throw or be cancelled.
vi.mock("./engine/CaptureChoiceEngine", () => ({
	CaptureChoiceEngine: class {
		constructor(
			_app: unknown,
			_plugin: unknown,
			private choice: ICaptureChoice,
			private executor: IChoiceExecutor,
		) {}
		async run() {
			const target = this.choice.captureTo;
			if (target === "throw") throw new Error("boom");
			if (target === "cancel") return this.executor.signalAbort?.(new UserCancelError("Input cancelled by user"));
			this.executor.recordExecutionResult?.(
				target === "fail"
					? { status: "error", reason: "failed" }
					: {
						status: "success", file: fileAt(target), effect: "changed",
						write: { path: target, before: "", after: "- new" },
					},
			);
		}
	},
}));

function fileAt(path: string): TFile {
	return { path, basename: path.replace(/\.md$/, "") } as TFile;
}

const { ChoiceExecutor } = await import("./choiceExecutor");

const app = { workspace: { getActiveFile: () => null } } as never;
const plugin = { app, settings: { choices: [] } } as never;

function capture(target: string): ICaptureChoice {
	return { id: `capture-${target}`, name: `Capture ${target}`, type: "Capture", captureTo: target } as ICaptureChoice;
}

function nested(choice: IChoice): ICommand {
	return { id: `nested-${choice.id}`, name: choice.name, type: CommandType.NestedChoice, choice } as ICommand;
}

function macro(name: string, commands: ICommand[]): IMacroChoice {
	return {
		id: name,
		name,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: { id: `${name}-macro`, name, commands },
	};
}

const notices = () => (Notice as unknown as NoticeStub).instances.map((notice) => notice.messageEl.textContent);

describe("ChoiceExecutor result notice", () => {
	beforeEach(() => {
		(Notice as unknown as NoticeStub).instances.length = 0;
		settings.showCaptureNotification = true;
		runLog.clear();
	});

	it("shows one notice for an outermost run, with Open and Undo", async () => {
		await new ChoiceExecutor(app, plugin).execute(capture("a.md"));
		expect(notices()).toEqual(["Capture a.md: added to 'a'OpenUndo"]);
	});

	it("shows one notice for a macro, for its last write, and none for the runs nested in it", async () => {
		await new ChoiceExecutor(app, plugin).execute(macro("M", [nested(capture("a.md")), nested(capture("b.md"))]));
		expect(notices()).toEqual(["M: added to 'b'OpenUndo"]);
	});

	it("shows nothing when the run recorded no success", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		await executor.execute(capture("fail"));
		await executor.execute(capture("cancel"));
		await expect(executor.execute(capture("throw"))).rejects.toThrow("boom");
		expect(notices()).toEqual([]);
	});

	it("shows nothing when capture notifications are off", async () => {
		settings.showCaptureNotification = false;
		await new ChoiceExecutor(app, plugin).execute(capture("a.md"));
		expect(notices()).toEqual([]);
	});

	it("shows nothing for a run that returns its outcome to the caller", async () => {
		const outcome = await new ChoiceExecutor(app, plugin).executeWithOutcome(capture("a.md"));
		expect(outcome).toMatchObject({ status: "success", effect: "changed" });
		expect(notices()).toEqual([]);
	});
});

describe("ChoiceExecutor run log", () => {
	beforeEach(() => {
		settings.showCaptureNotification = false;
		runLog.clear();
	});

	it("logs one entry per outermost run, with the note the run last wrote", async () => {
		await new ChoiceExecutor(app, plugin).execute(macro("M", [nested(capture("a.md")), nested(capture("b.md"))]));
		expect(runLog.list()).toEqual([expect.objectContaining({
			choiceId: "M", choiceName: "M", status: "success", effect: "changed", path: "b.md",
			at: expect.any(String), durationMs: expect.any(Number),
		})]);
	});

	it("logs a failed, a cancelled and a thrown run", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		await executor.execute(capture("fail"));
		await executor.execute(capture("cancel"));
		await expect(executor.execute(capture("throw"))).rejects.toThrow("boom");
		expect(runLog.list().map(({ choiceName, status, reason }) => ({ choiceName, status, reason }))).toEqual([
			{ choiceName: "Capture throw", status: "error", reason: "boom" },
			{ choiceName: "Capture cancel", status: "cancelled", reason: undefined },
			{ choiceName: "Capture fail", status: "error", reason: "failed" },
		]);
	});

	it("logs a run that returns its outcome to the caller", async () => {
		await new ChoiceExecutor(app, plugin).executeWithOutcome(capture("a.md"));
		expect(runLog.list()).toEqual([expect.objectContaining({
			choiceName: "Capture a.md", status: "success", effect: "changed", path: "a.md",
		})]);
	});
});
