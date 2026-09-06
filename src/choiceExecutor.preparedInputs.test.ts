import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import realMoment from "moment";
import { App } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import { TemplateChoice } from "./types/choices/TemplateChoice";
import { CaptureChoice } from "./types/choices/CaptureChoice";
import { MacroChoice } from "./types/choices/MacroChoice";
import { NestedChoiceCommand } from "./types/macros/QuickCommands/NestedChoiceCommand";
import { QA_INTERNAL_DATE_ORIGIN } from "./constants";
import {
	getPreparedTemplateNoteSelection,
	markDiscoveryMacro,
	setPreparedChoiceInputs,
} from "./preflight/preparedChoiceInputs";
import { UserCancelError } from "./errors/UserCancelError";

vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("./main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("./quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("./settingsStore", () => ({
	settingsStore: { getState: () => ({ onePageInputEnabled: false, ai: {}, disableOnlineFeatures: true }) },
}));
vi.mock("./preflight/runOnePagePreflight", () => ({ runOnePagePreflight: vi.fn() }));
vi.mock("./utils/frontmatterPropertyLinks", () => ({ getFocusedPropertyTarget: () => null }));
vi.mock("./utilityObsidian", async (importOriginal) => ({
	...await importOriginal<Record<string, unknown>>(),
	getOpenFileOriginLeaf: () => null,
}));
const datePrompt = vi.fn(async () => "@date:2026-09-06");
vi.mock("./gui/VDateInputPrompt/VDateInputPrompt", () => ({ default: { Prompt: datePrompt } }));
const runTemplate = vi.fn<(executor: IChoiceExecutor, choice: IChoice) => Promise<void>>();
const runCapture = vi.fn<(executor: IChoiceExecutor, choice: IChoice) => Promise<void>>();
vi.mock("./engine/TemplateChoiceEngine", () => ({
	TemplateChoiceEngine: class {
		constructor(_app: unknown, _plugin: unknown, private choice: IChoice, private executor: IChoiceExecutor) {}
		async run() { await runTemplate(this.executor, this.choice); }
	},
}));
vi.mock("./engine/CaptureChoiceEngine", () => ({
	CaptureChoiceEngine: class {
		constructor(_app: unknown, _plugin: unknown, private choice: IChoice, private executor: IChoiceExecutor) {}
		async run() { await runCapture(this.executor, this.choice); }
	},
}));

const { ChoiceExecutor } = await import("./choiceExecutor");
const originalMoment = window.moment;
beforeAll(() => { window.moment = realMoment; });
afterAll(() => { window.moment = originalMoment; });

function executor() {
	return new ChoiceExecutor(new App(), {} as QuickAdd);
}

function discoveryChoice() {
	const choice = new TemplateChoice("Discover note");
	choice.discoverExistingNotesBeforeCreate = true;
	choice.dateOrigin = { kind: "ask" };
	return choice;
}

function prepareExisting(runner: IChoiceExecutor, choice: IChoice, occurrenceId = choice.id) {
	setPreparedChoiceInputs(runner, occurrenceId, {
		choiceId: choice.id,
		values: new Map(),
		discovery: { kind: "existing", path: "Existing.md" },
	});
}

describe("ChoiceExecutor prepared input lifecycle", () => {
	beforeEach(() => {
		datePrompt.mockClear();
		runTemplate.mockReset();
		runTemplate.mockImplementation(async (runner) => {
			runner.recordExecutionResult?.({ status: "success", effect: "unchanged" });
		});
		runCapture.mockReset();
	});

	it.each(["execute", "executeWithOutcome"] as const)(
		"%s opens an existing note without prompting for its hidden creation date",
		async (method) => {
			const runner = executor();
			const choice = discoveryChoice();
			prepareExisting(runner, choice);
			await runner[method](choice);
			expect(runTemplate).toHaveBeenCalledTimes(1);
			expect(datePrompt).not.toHaveBeenCalled();
			expect(runner.preparedInputs.active).toBeNull();
		},
	);

	it.each(["execute", "executeWithOutcome"] as const)(
		"%s honors a scripted value that replaces the prepared existing-note selection",
		async (method) => {
			const runner = executor();
			const choice = discoveryChoice();
			prepareExisting(runner, choice);
			runner.variables.set("value", "Scripted new title");
			let appliedDate: Date | undefined;
			runTemplate.mockImplementation(async (active) => { appliedDate = active.clocks?.date; });
			await runner[method](choice);
			expect(datePrompt).toHaveBeenCalledTimes(1);
			expect(realMoment(appliedDate).format("YYYY-MM-DD")).toBe("2026-09-06");
			expect(runner.variables.get("value")).toBe("Scripted new title");
		},
	);

	it("keeps the macro date for a following Capture after opening an existing note", async () => {
		const runner = executor();
		const choice = discoveryChoice();
		const capture = new CaptureChoice("Capture");
		capture.dateOrigin = { kind: "ask" };
		const macro = new MacroChoice("Macro");
		macro.dateOrigin = { kind: "ask" };
		const noteCommand = new NestedChoiceCommand(choice);
		macro.macro.commands = [noteCommand, new NestedChoiceCommand(capture)];
		const macroDate = new Date(2026, 8, 5);
		runner.variables.set(QA_INTERNAL_DATE_ORIGIN, macroDate);
		prepareExisting(runner, choice, noteCommand.id);
		let captureDate: Date | undefined;
		runCapture.mockImplementation(async (active) => { captureDate = active.clocks?.date; });
		await runner.execute(macro);
		expect(runTemplate).toHaveBeenCalledTimes(1);
		expect(runCapture).toHaveBeenCalledTimes(1);
		expect(captureDate).toBe(macroDate);
		expect(datePrompt).not.toHaveBeenCalled();
	});

	it.each(["execute", "executeWithOutcome"] as const)(
		"%s clears queued answers and macro mode after cancellation",
		async (method) => {
			const runner = executor();
			const choice = discoveryChoice();
			prepareExisting(runner, choice);
			prepareExisting(runner, choice, "unreached-command");
			markDiscoveryMacro(runner, "macro");
			runTemplate.mockRejectedValueOnce(new UserCancelError("Cancelled"));
			if (method === "execute") {
				await expect(runner.execute(choice)).rejects.toBeInstanceOf(UserCancelError);
			} else {
				await expect(runner.executeWithOutcome(choice))
					.resolves.toEqual({ status: "cancelled", cancelKind: "user" });
			}
			expect(runner.preparedInputs.pending.size).toBe(0);
			expect(runner.preparedInputs.discoveryMacros.size).toBe(0);
			expect(runner.preparedInputs.active).toBeNull();
		},
	);

	it("restores outer inputs after nested execution and clears them only when the outer run ends", async () => {
		const runner = executor();
		const outer = discoveryChoice();
		const inner = discoveryChoice();
		prepareExisting(runner, outer);
		prepareExisting(runner, inner);
		markDiscoveryMacro(runner, "outer-macro");
		runTemplate.mockImplementation(async (active, choice) => {
			expect(getPreparedTemplateNoteSelection(active, choice.id)?.kind).toBe("existing");
			if (choice.id === outer.id) {
				await runner.execute(inner);
				expect(getPreparedTemplateNoteSelection(active, outer.id)?.kind).toBe("existing");
				expect(active.preparedInputs.discoveryMacros.has("outer-macro")).toBe(true);
			}
		});
		await runner.execute(outer);
		expect(runTemplate).toHaveBeenCalledTimes(2);
		expect(runner.preparedInputs.active).toBeNull();
		expect(runner.preparedInputs.discoveryMacros.size).toBe(0);
	});
});
