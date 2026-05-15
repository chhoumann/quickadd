import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";
import { MacroAbortError } from "./errors/MacroAbortError";
import { settingsStore } from "./settingsStore";

const mocks = vi.hoisted(() => {
	const runOnePagePreflight = vi.fn();
	const getOpenFileOriginLeaf = vi.fn();
	const templateRun = vi.fn();
	const captureRun = vi.fn();
	const macroRun = vi.fn();
	const templateConstructors: unknown[][] = [];
	const captureConstructors: unknown[][] = [];
	const macroConstructors: unknown[][] = [];
	const choiceSuggesterOpen = vi.fn();

	return {
		runOnePagePreflight,
		getOpenFileOriginLeaf,
		templateRun,
		captureRun,
		macroRun,
		templateConstructors,
		captureConstructors,
		macroConstructors,
		choiceSuggesterOpen,
	};
});

vi.mock("./preflight/runOnePagePreflight", () => ({
	runOnePagePreflight: mocks.runOnePagePreflight,
}));

vi.mock("./utilityObsidian", () => ({
	getOpenFileOriginLeaf: mocks.getOpenFileOriginLeaf,
}));

vi.mock("./engine/TemplateChoiceEngine", () => ({
	TemplateChoiceEngine: vi.fn(function (...args: unknown[]) {
		mocks.templateConstructors.push(args);
		return { run: mocks.templateRun };
	}),
}));

vi.mock("./engine/CaptureChoiceEngine", () => ({
	CaptureChoiceEngine: vi.fn(function (...args: unknown[]) {
		mocks.captureConstructors.push(args);
		return { run: mocks.captureRun };
	}),
}));

vi.mock("./engine/MacroCommandRunner", () => ({
	MacroCommandRunner: vi.fn(function (...args: unknown[]) {
		mocks.macroConstructors.push(args);
		return {
			run: mocks.macroRun,
			params: { variables: {} },
		};
	}),
}));

vi.mock("./engine/InlineJavaScriptEvaluator", () => ({
	InlineJavaScriptEvaluator: vi.fn(function () {
		return { runAndGetOutput: vi.fn() };
	}),
}));

vi.mock("./engine/SingleMacroEngine", () => ({
	SingleMacroEngine: vi.fn(function () {
		return { runAndGetOutput: vi.fn() };
	}),
}));

vi.mock("./gui/suggesters/choiceSuggester", () => ({
	default: {
		Open: mocks.choiceSuggesterOpen,
	},
}));

import { ChoiceExecutor } from "./choiceExecutor";

describe("ChoiceExecutor", () => {
	const app = {} as App;
	const originLeaf = { id: "origin-leaf" } as unknown as WorkspaceLeaf;
	let plugin: QuickAdd;

	beforeEach(() => {
		plugin = {
			settings: {
				choices: [],
			},
		} as unknown as QuickAdd;
		settingsStore.setState({ onePageInputEnabled: false });
		mocks.runOnePagePreflight.mockReset();
		mocks.getOpenFileOriginLeaf.mockReset();
		mocks.getOpenFileOriginLeaf.mockReturnValue(originLeaf);
		mocks.templateRun.mockReset();
		mocks.templateRun.mockResolvedValue(undefined);
		mocks.captureRun.mockReset();
		mocks.captureRun.mockResolvedValue(undefined);
		mocks.macroRun.mockReset();
		mocks.macroRun.mockResolvedValue(undefined);
		mocks.choiceSuggesterOpen.mockReset();
		mocks.templateConstructors.length = 0;
		mocks.captureConstructors.length = 0;
		mocks.macroConstructors.length = 0;
	});

	it.each(["Template", "Capture", "Macro"] as const)(
		"runs preflight before dispatching %s choices when one-page input is enabled",
		async (type) => {
			const executor = new ChoiceExecutor(app, plugin);
			const choice = createChoice(type, { onePageInput: "always" });

			await executor.execute(choice);

			expect(mocks.runOnePagePreflight).toHaveBeenCalledWith(
				app,
				plugin,
				executor,
				choice,
			);
			expect(runtimeRunsFor(type)).toHaveBeenCalledTimes(1);
		},
	);

	it("throws MacroAbortError and suppresses runtime construction after preflight cancellation", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		mocks.runOnePagePreflight.mockRejectedValueOnce("cancelled");

		await expect(
			executor.execute(createChoice("Template", { onePageInput: "always" })),
		).rejects.toMatchObject({
			name: "MacroAbortError",
			message: "One-page input cancelled by user",
		});
		expect(mocks.templateConstructors).toHaveLength(0);
		expect(mocks.captureConstructors).toHaveLength(0);
		expect(mocks.macroConstructors).toHaveLength(0);
	});

	it("skips preflight for Multi choices and opens the multi suggester", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		const child = createChoice("Template");
		const multi: IMultiChoice = {
			...createChoice("Multi"),
			choices: [child],
			collapsed: false,
			placeholder: "Pick one",
		};

		await executor.execute(multi);

		expect(mocks.runOnePagePreflight).not.toHaveBeenCalled();
		expect(mocks.choiceSuggesterOpen).toHaveBeenCalledWith(plugin, [child], {
			choiceExecutor: executor,
			placeholder: "Pick one",
		});
	});

	it.each([
		["Template", mocks.templateConstructors],
		["Capture", mocks.captureConstructors],
	] as const)(
		"captures and passes the origin leaf to %s runtime construction",
		async (type, constructors) => {
			const executor = new ChoiceExecutor(app, plugin);
			const choice = createChoice(type);

			await executor.execute(choice);

			expect(mocks.getOpenFileOriginLeaf).toHaveBeenCalledWith(app);
			expect(constructors[0]?.at(-1)).toBe(originLeaf);
		},
	);

	it("passes the origin leaf and shared variables map to macro runtime construction", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		executor.variables.set("seed", "value");
		const choice = createChoice("Macro");

		await executor.execute(choice);

		expect(mocks.macroConstructors[0]?.[4]).toBe(executor.variables);
		expect(mocks.macroConstructors[0]?.at(-1)).toBe(originLeaf);
	});

	it("keeps the same variable map instance across preflight and dispatch", async () => {
		const executor = new ChoiceExecutor(app, plugin);
		const seenMaps: Map<string, unknown>[] = [];
		mocks.runOnePagePreflight.mockImplementationOnce(
			async (_app, _plugin, choiceExecutor: ChoiceExecutor) => {
				seenMaps.push(choiceExecutor.variables);
				choiceExecutor.variables.set("fromPreflight", "submitted");
			},
		);

		await executor.execute(createChoice("Macro", { onePageInput: "always" }));

		expect(seenMaps[0]).toBe(executor.variables);
		expect(mocks.macroConstructors[0]?.[4]).toBe(executor.variables);
		expect(executor.variables.get("fromPreflight")).toBe("submitted");
	});

	it("records and consumes abort signals exactly once", () => {
		const executor = new ChoiceExecutor(app, plugin);
		const abort = new MacroAbortError("stopped");

		executor.signalAbort(abort);

		expect(executor.consumeAbortSignal()).toBe(abort);
		expect(executor.consumeAbortSignal()).toBeNull();
	});
});

function createChoice(
	type: IChoice["type"],
	extras: Partial<IChoice> = {},
): IChoice {
	return {
		id: `${type.toLowerCase()}-choice`,
		name: `${type} Choice`,
		type,
		command: false,
		...extras,
	};
}

function runtimeRunsFor(type: "Template" | "Capture" | "Macro") {
	switch (type) {
		case "Template":
			return mocks.templateRun;
		case "Capture":
			return mocks.captureRun;
		case "Macro":
			return mocks.macroRun;
	}
}
