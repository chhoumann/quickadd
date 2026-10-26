import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import realMoment from "moment";
import { App } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import { TemplateChoice } from "./types/choices/TemplateChoice";
import { MacroChoice } from "./types/choices/MacroChoice";
import { NestedChoiceCommand } from "./types/macros/QuickCommands/NestedChoiceCommand";
import { ChoiceAbortError } from "./errors/ChoiceAbortError";

vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("./main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("./quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("./settingsStore", () => ({
	settingsStore: { getState: () => ({ onePageInputEnabled: false, ai: {}, disableOnlineFeatures: true }) },
}));
vi.mock("./utils/frontmatterPropertyLinks", () => ({ getFocusedPropertyTarget: () => null }));
vi.mock("./utils/fileOpening", async (importOriginal) => ({
	...await importOriginal<Record<string, unknown>>(),
	getOpenFileOriginLeaf: () => null,
}));
const datePrompt = vi.fn(async () => "@date:2026-03-01");
vi.mock("./gui/VDateInputPrompt/VDateInputPrompt", () => ({ default: { Prompt: datePrompt } }));
const runTemplate = vi.fn<(executor: IChoiceExecutor, choice: IChoice) => Promise<void>>();
vi.mock("./engine/TemplateChoiceEngine", () => ({
	TemplateChoiceEngine: class {
		constructor(_app: unknown, _plugin: unknown, private choice: IChoice, private executor: IChoiceExecutor) {}
		async run() { await runTemplate(this.executor, this.choice); }
	},
}));

const { ChoiceExecutor } = await import("./choiceExecutor");
const { QuickAddApi } = await import("./quickAddApi");
const { applyInvocationDate } = await import("./utils/resolveDateOrigin");
const originalMoment = window.moment;
beforeAll(() => { window.moment = realMoment; });
afterAll(() => { window.moment = originalMoment; });

function executor() {
	return new ChoiceExecutor(new App(), {} as QuickAdd);
}

describe("ChoiceExecutor date scope", () => {
	const day = (date: Date | undefined) => realMoment(date).format("YYYY-MM-DD");

	function datedTemplate(name: string, dateOrigin?: IChoice["dateOrigin"]) {
		const choice = new TemplateChoice(name);
		choice.dateOrigin = dateOrigin;
		return choice;
	}

	beforeEach(() => {
		runTemplate.mockReset();
		datePrompt.mockClear();
	});

	function recordDays() {
		const days: Record<string, string> = {};
		runTemplate.mockImplementation(async (active, choice) => { days[choice.name] = day(active.clocks?.date); });
		return days;
	}

	it("gives each nested Template in a macro its own variable day", async () => {
		const runner = executor();
		const days = recordDays();
		const macro = new MacroChoice("Macro");
		macro.macro.commands = [
			new NestedChoiceCommand(datedTemplate("Yesterday", { kind: "variable", name: "yesterday" })),
			new NestedChoiceCommand(datedTemplate("Tomorrow", { kind: "variable", name: "tomorrow" })),
		];
		runner.variables.set("yesterday", "2026-01-02");
		runner.variables.set("tomorrow", "2026-01-04");

		await runner.execute(macro);

		expect(days).toEqual({ Yesterday: "2026-01-02", Tomorrow: "2026-01-04" });
	});

	it("hands a macro's own day to every nested Template", async () => {
		const runner = executor();
		const days = recordDays();
		const macro = new MacroChoice("Macro");
		macro.dateOrigin = { kind: "variable", name: "day" };
		macro.macro.commands = [
			new NestedChoiceCommand(datedTemplate("First")),
			new NestedChoiceCommand(datedTemplate("Second")),
		];
		runner.variables.set("day", "2026-01-02");

		await runner.execute(macro);

		expect(days).toEqual({ First: "2026-01-02", Second: "2026-01-02" });
	});

	function macroOf(...children: IChoice[]) {
		const macro = new MacroChoice("Macro");
		macro.macro.commands = children.map((child) => new NestedChoiceCommand(child));
		return macro;
	}

	it("keeps a nested variable day when the macro is run with Pick a day", async () => {
		const runner = executor();
		const days = recordDays();
		runner.variables.set("testDate", "2026-01-02");
		runner.pickDate = true;

		await runner.execute(macroOf(
			datedTemplate("Variable", { kind: "variable", name: "testDate" }),
			datedTemplate("Today"),
		));

		expect(datePrompt).toHaveBeenCalledTimes(1);
		expect(days).toEqual({ Variable: "2026-01-02", Today: "2026-03-01" });
	});

	it("keeps a nested variable day under a macro's own Which day", async () => {
		const runner = executor();
		const days = recordDays();
		const macro = macroOf(
			datedTemplate("Variable", { kind: "variable", name: "testDate" }),
			datedTemplate("Yesterday", { kind: "relative", offset: -1, unit: "days" }),
		);
		macro.dateOrigin = { kind: "variable", name: "macroDay" };
		runner.variables.set("macroDay", "2026-01-05");
		runner.variables.set("testDate", "2026-01-02");

		await runner.execute(macro);

		expect(days).toEqual({ Variable: "2026-01-02", Yesterday: "2026-01-05" });
	});

	it("keeps a nested variable day under an invocation date", async () => {
		const runner = executor();
		const days = recordDays();
		runner.variables.set("testDate", "2026-01-02");
		applyInvocationDate(runner, "2026-03-01");

		await runner.execute(macroOf(
			datedTemplate("Variable", { kind: "variable", name: "testDate" }),
			datedTemplate("Today"),
		));

		expect(days).toEqual({ Variable: "2026-01-02", Today: "2026-03-01" });
	});

	it("lets an invocation date replace the invoked choice's own variable day", async () => {
		const runner = executor();
		const days = recordDays();
		applyInvocationDate(runner, "2026-03-01");

		await runner.execute(datedTemplate("Variable", { kind: "variable", name: "unset" }));

		expect(days).toEqual({ Variable: "2026-03-01" });
	});

	it("gives each executeChoice call its own day and keeps it out of the caller", async () => {
		const runner = executor();
		const days = recordDays();
		const choices = [
			datedTemplate("Today template"),
			datedTemplate("Variable template", { kind: "variable", name: "day" }),
		];
		const plugin = { settings: { choices } } as unknown as QuickAdd;
		const api = QuickAddApi.GetApi(new App(), plugin, runner);
		const caller = datedTemplate("Caller");
		runTemplate.mockImplementation(async (active, choice) => {
			if (choice.name !== "Caller") {
				days[`${choice.name} ${Object.keys(days).length}`] = day(active.clocks?.date);
				return;
			}
			await api.executeChoice("Today template", {}, { date: "2026-01-02" });
			await api.executeChoice("Today template", {}, { date: "2026-01-03" });
			await api.executeChoice("Variable template", { day: "2026-01-04" });
			await api.executeChoice("Variable template", { day: "2026-01-05" });
			days.Caller = active.clocks?.date === undefined ? "today" : day(active.clocks.date);
		});

		await runner.execute(caller);

		expect(days).toEqual({
			"Today template 0": "2026-01-02",
			"Today template 1": "2026-01-03",
			"Variable template 2": "2026-01-04",
			"Variable template 3": "2026-01-05",
			Caller: "today",
		});
	});

	it("keeps the caller's day when an executeChoice call fails", async () => {
		const runner = executor();
		const failing = datedTemplate("Failing");
		const plugin = { settings: { choices: [failing] } } as unknown as QuickAdd;
		const api = QuickAddApi.GetApi(new App(), plugin, runner);
		const caller = datedTemplate("Caller", { kind: "variable", name: "callerDay" });
		runner.variables.set("callerDay", "2026-01-10");
		let callerDay: string | undefined;
		runTemplate.mockImplementation(async (active, choice) => {
			if (choice.name === "Failing") throw new ChoiceAbortError("failed");
			await expect(api.executeChoice("Failing", {}, { date: "2026-01-02" })).rejects.toThrow("failed");
			callerDay = day(active.clocks?.date);
		});

		await runner.execute(caller);

		expect(callerDay).toBe("2026-01-10");
	});
});
