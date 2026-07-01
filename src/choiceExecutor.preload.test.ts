import { describe, expect, it, vi } from "vitest";

// Mock the heavy leaves of the executor's import graph (mirrors the mock sets
// of MacroChoiceEngine.entry.test.ts and choiceSuggester.test.ts).
vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
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

const { ChoiceExecutor } = await import("./choiceExecutor");

describe("ChoiceExecutor preloadedUserScripts lifecycle", () => {
	it("clears leftover preloaded modules when the outermost execution ends", async () => {
		const executor = new ChoiceExecutor(
			{ workspace: { getActiveFile: () => null } } as never,
			{} as never,
		);
		// Simulate a collection pass that loaded a module whose command never
		// ran (cancelled modal / aborted macro): the entry must not survive to
		// the NEXT trigger on a long-lived executor, where it would hand the
		// engine a module loaded before the user's latest edits.
		executor.preloadedUserScripts.set("stale.js", { entry: () => {} });

		await executor.execute({
			id: "unknown",
			name: "Unknown",
			type: "Nonexistent",
		} as never);

		expect(executor.preloadedUserScripts.size).toBe(0);
	});

	it("keeps entries alive while nested executions are still running", () => {
		const executor = new ChoiceExecutor(
			{ workspace: { getActiveFile: () => null } } as never,
			{} as never,
		);
		executor.preloadedUserScripts.set("outer.js", {});

		// Depth 2 -> 1: a nested execute() ending must NOT wipe the outer
		// run's preloaded modules.
		(executor as unknown as { executionDepth: number }).executionDepth = 2;
		(executor as unknown as { endExecutionContext(): void }).endExecutionContext();
		expect(executor.preloadedUserScripts.size).toBe(1);

		// Depth 1 -> 0: the outermost end clears.
		(executor as unknown as { endExecutionContext(): void }).endExecutionContext();
		expect(executor.preloadedUserScripts.size).toBe(0);
	});
});
