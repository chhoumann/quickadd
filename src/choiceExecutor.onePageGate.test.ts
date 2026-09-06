import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import type QuickAdd from "./main";
import { MacroChoice } from "./types/choices/MacroChoice";
import { TemplateChoice } from "./types/choices/TemplateChoice";
import { NestedChoiceCommand } from "./types/macros/QuickCommands/NestedChoiceCommand";
import type IChoice from "./types/choices/IChoice";

// Mock the heavy leaves of the executor's import graph (mirrors
// choiceExecutor.preload.test.ts).
vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("./main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("./quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));

let onePageInputEnabled = false;
const runTemplate = vi.fn<(choice: IChoice) => Promise<void>>(async () => {});
vi.mock("./settingsStore", () => ({
	settingsStore: {
		getState: () => ({ onePageInputEnabled, ai: {}, disableOnlineFeatures: true }),
	},
}));
vi.mock("./engine/runTemplateFromFolder", () => ({
	runTemplateFromFolder: vi.fn(),
}));
vi.mock("./engine/TemplateChoiceEngine", () => ({
	TemplateChoiceEngine: class {
		constructor(_app: unknown, _plugin: unknown, private choice: IChoice) {}
		async run() { await runTemplate(this.choice); }
	},
}));
vi.mock("./utils/frontmatterPropertyLinks", () => ({
	getFocusedPropertyTarget: vi.fn(() => null),
}));
vi.mock("./utilityObsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getOpenFileOriginLeaf: vi.fn(() => null),
	};
});

const runOnePagePreflight = vi.fn<(...args: unknown[]) => Promise<unknown>>(
	async () => true,
);
vi.mock("./preflight/runOnePagePreflight", () => ({
	runOnePagePreflight,
}));

const { ChoiceExecutor } = await import("./choiceExecutor");
const { UserCancelError } = await import("./errors/UserCancelError");

type GateHarness = {
	runOnePagePreflightIfEnabled(choice: unknown): Promise<void>;
	promptProvider: unknown;
};

function makeExecutor(): GateHarness {
	return new ChoiceExecutor(
		{ workspace: { getActiveFile: () => null } } as never,
		{} as never,
	) as unknown as GateHarness;
}

function choice(
	type: string,
	onePageInput?: "always" | "never",
): Record<string, unknown> {
	return { id: "gate-test", name: "Gate test", type, onePageInput };
}

describe("ChoiceExecutor one-page preflight gate", () => {
	beforeEach(() => {
		onePageInputEnabled = false;
		runOnePagePreflight.mockClear();
		runOnePagePreflight.mockResolvedValue(true);
	});

	it("runs preflight when the global toggle is on and the choice follows it", async () => {
		onePageInputEnabled = true;
		await makeExecutor().runOnePagePreflightIfEnabled(choice("Template"));
		expect(runOnePagePreflight).toHaveBeenCalledTimes(1);
	});

	it("skips preflight when the global toggle is off and the choice follows it", async () => {
		await makeExecutor().runOnePagePreflightIfEnabled(choice("Template"));
		expect(runOnePagePreflight).not.toHaveBeenCalled();
	});

	it("per-choice 'always' beats a disabled global toggle", async () => {
		await makeExecutor().runOnePagePreflightIfEnabled(
			choice("Capture", "always"),
		);
		expect(runOnePagePreflight).toHaveBeenCalledTimes(1);
	});

	it("per-choice 'never' beats an enabled global toggle", async () => {
		onePageInputEnabled = true;
		await makeExecutor().runOnePagePreflightIfEnabled(
			choice("Template", "never"),
		);
		expect(runOnePagePreflight).not.toHaveBeenCalled();
	});

	it("a remote prompt provider forces preflight even with the global toggle off", async () => {
		const executor = makeExecutor();
		executor.promptProvider = {};
		await executor.runOnePagePreflightIfEnabled(choice("Template"));
		expect(runOnePagePreflight).toHaveBeenCalledTimes(1);
	});

	it("per-choice 'never' beats a remote prompt provider", async () => {
		const executor = makeExecutor();
		executor.promptProvider = {};
		await executor.runOnePagePreflightIfEnabled(choice("Template", "never"));
		expect(runOnePagePreflight).not.toHaveBeenCalled();
	});

	it("applies to Macro choices", async () => {
		onePageInputEnabled = true;
		await makeExecutor().runOnePagePreflightIfEnabled(choice("Macro"));
		expect(runOnePagePreflight).toHaveBeenCalledTimes(1);
	});

	it("never runs for Multi choices, even with 'always'", async () => {
		onePageInputEnabled = true;
		await makeExecutor().runOnePagePreflightIfEnabled(
			choice("Multi", "always"),
		);
		expect(runOnePagePreflight).not.toHaveBeenCalled();
	});

	it("converts a modal cancellation into UserCancelError so the run aborts", async () => {
		onePageInputEnabled = true;
		// Byte-faithful to OnePageInputModal's rejection value.
		runOnePagePreflight.mockRejectedValue("cancelled");
		await expect(
			makeExecutor().runOnePagePreflightIfEnabled(choice("Template")),
		).rejects.toThrow(UserCancelError);
	});

	it("execute() runs the gate before any engine, with the executor and choice", async () => {
		// Pin the wiring, not just the gate logic: a refactor that drops the
		// runOnePagePreflightIfEnabled call from execute() must fail here. The
		// preflight rejects with the modal's cancellation value, so execution
		// stops at the gate and no engine is ever constructed.
		onePageInputEnabled = true;
		runOnePagePreflight.mockRejectedValue("cancelled");
		const executor = makeExecutor() as unknown as InstanceType<
			typeof ChoiceExecutor
		>;
		const templateChoice = choice("Template");
		await expect(
			executor.execute(templateChoice as never),
		).rejects.toThrow(UserCancelError);
		expect(runOnePagePreflight).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			executor,
			templateChoice,
		);
	});

	it("rethrows non-cancellation preflight errors unchanged", async () => {
		onePageInputEnabled = true;
		const boom = new Error("collection exploded");
		runOnePagePreflight.mockRejectedValue(boom);
		await expect(
			makeExecutor().runOnePagePreflightIfEnabled(choice("Template")),
		).rejects.toBe(boom);
	});
});

describe("macro one-page override scope", () => {
	beforeEach(() => {
		onePageInputEnabled = false;
		runOnePagePreflight.mockReset();
		runOnePagePreflight.mockResolvedValue(true);
		runTemplate.mockReset();
		runTemplate.mockResolvedValue(undefined);
	});

	function macro(name: string, override: IChoice["onePageInput"], children: IChoice[]) {
		const result = new MacroChoice(name);
		result.onePageInput = override;
		result.macro.commands = children.map((child) => new NestedChoiceCommand(child));
		return result;
	}

	function executor() {
		return new ChoiceExecutor(new App(), {} as QuickAdd);
	}

	it("collects the remaining commands together after opted-out discovery finishes", async () => {
		const discovery = new TemplateChoice("Discover");
		discovery.onePageInput = "never";
		discovery.discoverExistingNotesBeforeCreate = true;
		const first = new TemplateChoice("First");
		const second = new TemplateChoice("Second");
		const parent = macro("Parent", "always", [discovery, first, second]);
		const runner = executor();
		const prepare = vi.spyOn(runner, "prepareMacroInputs");
		await runner.execute(parent);
		expect(prepare).toHaveBeenCalledExactlyOnceWith(parent, parent.macro.commands.slice(1));
		expect(prepare.mock.invocationCallOrder[0]).toBeGreaterThan(runTemplate.mock.invocationCallOrder[0]);
		expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(runTemplate.mock.invocationCallOrder[1]);
		expect(runOnePagePreflight).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), runner, {
			...parent,
			macro: { ...parent.macro, commands: parent.macro.commands.slice(1) },
		});
		expect(parent.macro.commands).toHaveLength(3);
	});

	it.each(["API title", ""])("does not split an explicitly seeded discovery run (%j)", async (seed) => {
		const discovery = new TemplateChoice("Discover");
		discovery.onePageInput = "never";
		discovery.discoverExistingNotesBeforeCreate = true;
		const runner = executor();
		runner.variables.set("value", seed);
		const prepare = vi.spyOn(runner, "prepareMacroInputs");
		await runner.execute(macro("Parent", "always", [discovery, new TemplateChoice("Next")]));
		expect(prepare).not.toHaveBeenCalled();
		expect(runner.variables.get("value")).toBe(seed);
	});

	it("does not open the remaining form after discovery is cancelled", async () => {
		const discovery = new TemplateChoice("Discover");
		discovery.onePageInput = "never";
		discovery.discoverExistingNotesBeforeCreate = true;
		runTemplate.mockRejectedValueOnce(new UserCancelError("Cancelled"));
		const runner = executor();
		const prepare = vi.spyOn(runner, "prepareMacroInputs");
		await runner.execute(macro("Parent", "always", [discovery, new TemplateChoice("Next")]));
		expect(prepare).not.toHaveBeenCalled();
		expect(runTemplate).toHaveBeenCalledTimes(1);
	});

	it("inherits Always at deferred steps but preserves a step's Never", async () => {
		const included = new TemplateChoice("Included");
		const excluded = new TemplateChoice("Excluded");
		excluded.onePageInput = "never";
		const parent = macro("Parent", "always", [included, excluded]);
		await executor().execute(parent);
		expect(runOnePagePreflight.mock.calls.map((call) => call[3])).toEqual([
			parent,
			included,
		]);
	});

	it("inherits Never but preserves a step's Always", async () => {
		onePageInputEnabled = true;
		const included = new TemplateChoice("Included");
		included.onePageInput = "always";
		const excluded = new TemplateChoice("Excluded");
		await executor().execute(macro("Parent", "never", [included, excluded]));
		expect(runOnePagePreflight.mock.calls.map((call) => call[3])).toEqual([included]);
	});

	it("restores the enclosing override after a nested macro and global behavior after the run", async () => {
		const inheritedStep = new TemplateChoice("Inherited");
		const inherited = macro("Inherited macro", undefined, [inheritedStep]);
		const disabled = macro("Disabled macro", "never", [new TemplateChoice("Disabled")]);
		const following = new TemplateChoice("Following");
		const parent = macro("Parent", "always", [inherited, disabled, following]);
		const runner = executor();
		await runner.execute(parent);
		await runner.execute(new TemplateChoice("Outside"));
		expect(runOnePagePreflight.mock.calls.map((call) => call[3])).toEqual([
			parent,
			inherited,
			inheritedStep,
			following,
		]);
	});

	it("restores global behavior after a nested macro fails", async () => {
		const failure = new Error("Cannot collect inputs");
		runOnePagePreflight.mockResolvedValueOnce(true).mockRejectedValueOnce(failure);
		const nested = macro("Nested", "always", [new TemplateChoice("Unused")]);
		const runner = executor();
		await expect(runner.execute(macro("Parent", "never", [nested]))).rejects.toBe(failure);
		runOnePagePreflight.mockClear();
		await runner.execute(new TemplateChoice("Outside"));
		expect(runOnePagePreflight).not.toHaveBeenCalled();
	});
});
