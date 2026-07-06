import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./settingsStore", () => ({
	settingsStore: {
		getState: () => ({ onePageInputEnabled, ai: {}, disableOnlineFeatures: true }),
	},
}));
vi.mock("./engine/runTemplateFromFolder", () => ({
	runTemplateFromFolder: vi.fn(),
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
