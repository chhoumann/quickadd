import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import type IChoice from "./types/choices/IChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
import type { ICommand } from "./types/macros/ICommand";
import { CommandType } from "./types/macros/CommandType";
import type { IUserScript } from "./types/macros/IUserScript";
import type { IChoiceExecutor } from "./IChoiceExecutor";

const { scripts } = vi.hoisted(() => ({
	scripts: new Map<string, (params: unknown) => unknown>(),
}));

vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("./main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("./quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));
vi.mock("./settingsStore", () => ({
	settingsStore: {
		getState: () => ({ onePageInputEnabled: false, ai: {}, disableOnlineFeatures: true }),
	},
}));
vi.mock("./utils/frontmatterPropertyLinks", () => ({
	getFocusedPropertyTarget: vi.fn(() => null),
}));
vi.mock("./utils/fileOpening", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getOpenFileOriginLeaf: vi.fn(() => null),
}));
vi.mock("./utils/userScript", async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadUserScript: async (command: IUserScript) => ({
		script: scripts.get(command.path),
		settings: undefined,
	}),
}));
// A Capture that reports writing to its target, or failing when the target is "fail".
vi.mock("./engine/CaptureChoiceEngine", () => ({
	CaptureChoiceEngine: class {
		constructor(
			_app: unknown,
			_plugin: unknown,
			private choice: ICaptureChoice,
			private executor: IChoiceExecutor,
		) {}
		async run() {
			this.executor.recordExecutionResult?.(
				this.choice.captureTo === "fail"
					? { status: "error", reason: "failed" }
					: { status: "success", file: fileAt(this.choice.captureTo), effect: "changed" },
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

let seen: (string | null)[] = [];

function readsRunNote(executor: IChoiceExecutor, name: string): ICommand {
	const path = `${name}.js`;
	scripts.set(path, () => {
		seen.push(executor.runNote?.path ?? null);
	});
	return { id: `${name}-step`, name, type: CommandType.UserScript, path, settings: {} } as IUserScript;
}

function capture(target: string): ICaptureChoice {
	return { id: `capture-${target}`, name: target, type: "Capture", captureTo: target } as ICaptureChoice;
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

describe("ChoiceExecutor run note", () => {
	beforeEach(() => {
		scripts.clear();
		seen = [];
	});

	it("is the note the last write in the run wrote to", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		await executor.execute(macro("M", [
			readsRunNote(executor, "before"),
			nested(capture("a.md")),
			readsRunNote(executor, "afterA"),
			nested(capture("b.md")),
			readsRunNote(executor, "afterB"),
		]));
		expect(seen).toEqual([null, "a.md", "b.md"]);
	});

	it("keeps the last written note when a later write fails", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		await executor.execute(macro("M", [
			nested(capture("a.md")),
			nested(capture("fail")),
			readsRunNote(executor, "after"),
		]));
		expect(seen).toEqual(["a.md"]);
	});

	it("is visible to a nested run", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		await executor.execute(macro("Outer", [
			nested(capture("a.md")),
			nested(macro("Inner", [readsRunNote(executor, "inner")])),
		]));
		expect(seen).toEqual(["a.md"]);
	});

	it("starts empty for every outermost run and is cleared when it ends", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		await executor.execute(capture("a.md"));
		expect(executor.runNote).toBeNull();

		executor.runNote = fileAt("stale.md");
		await executor.execute(macro("M", [readsRunNote(executor, "first")]));
		expect(seen).toEqual([null]);
	});
});
