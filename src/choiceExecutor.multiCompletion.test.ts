import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the heavy leaves of the executor's import graph (mirrors
// choiceExecutor.onePageGate.test.ts).
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
		getState: () => ({
			onePageInputEnabled: false,
			ai: {},
			disableOnlineFeatures: true,
		}),
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

const openMock = vi.fn();
vi.mock("./gui/suggesters/choiceSuggester", () => ({
	__esModule: true,
	default: { Open: openMock },
	emptyFolderNoticeText: (folder: { name: string }) =>
		`Folder "${folder.name}" is empty.`,
}));

const { ChoiceExecutor } = await import("./choiceExecutor");
const { ChoiceAbortError } = await import("./errors/ChoiceAbortError");
const { UserCancelError, promptCancelled } = await import(
	"./errors/UserCancelError"
);

type SuggesterOptions = {
	completion?: (error?: unknown) => void;
};

function makeExecutor() {
	return new ChoiceExecutor(
		{ workspace: { getActiveFile: () => null } } as never,
		{} as never,
	);
}

function multiChoice(children: unknown[] = [{ id: "leaf", name: "Leaf", type: "Template" }]) {
	return {
		id: "multi-1",
		name: "My folder",
		type: "Multi",
		choices: children,
	} as never;
}

/** Whether `promise` has settled yet, checked without awaiting it to completion. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
	const marker = Symbol("pending");
	const raced = await Promise.race([
		promise.then(
			() => "settled",
			() => "settled",
		),
		Promise.resolve(marker),
	]);
	return raced !== marker;
}

describe("ChoiceExecutor Multi completion (#1630)", () => {
	beforeEach(() => {
		openMock.mockReset();
	});

	it("does not resolve execute() until the picker's completion settles", async () => {
		const executor = makeExecutor();

		const running = executor.execute(multiChoice());
		await vi.waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
		const options = openMock.mock.calls[0][2] as SuggesterOptions;
		expect(options.completion).toBeDefined();

		// The picker is open: the run must still be in flight.
		expect(await settled(running)).toBe(false);

		options.completion?.();
		await expect(running).resolves.toBeUndefined();
	});

	it("rejects execute() as a user cancel when the picker is dismissed", async () => {
		const executor = makeExecutor();

		const running = executor.execute(multiChoice());
		await vi.waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
		const options = openMock.mock.calls[0][2] as SuggesterOptions;

		options.completion?.(promptCancelled());
		await expect(running).rejects.toBeInstanceOf(UserCancelError);
	});

	it("signals an abort instead of opening a picker on a non-interactive run", async () => {
		const executor = makeExecutor();
		executor.interactive = false;

		await executor.execute(multiChoice());

		expect(openMock).not.toHaveBeenCalled();
		const abort = executor.consumeAbortSignal();
		expect(abort).toBeInstanceOf(ChoiceAbortError);
		expect(abort?.message).toContain("My folder");
	});

	it("signals an abort instead of opening a picker on a remote (promptProvider) run", async () => {
		const executor = makeExecutor();
		executor.promptProvider = {} as never;

		await executor.execute(multiChoice());

		expect(openMock).not.toHaveBeenCalled();
		expect(executor.consumeAbortSignal()).toBeInstanceOf(ChoiceAbortError);
	});

	it("names the empty folder when a non-interactive run hits one", async () => {
		const executor = makeExecutor();
		executor.interactive = false;

		await executor.execute(multiChoice([]));

		expect(openMock).not.toHaveBeenCalled();
		expect(executor.consumeAbortSignal()?.message).toBe(
			'Folder "My folder" is empty.',
		);
	});

	it("still completes quietly (Notice only) for an interactive empty folder", async () => {
		const executor = makeExecutor();

		await executor.execute(multiChoice([]));

		expect(openMock).not.toHaveBeenCalled();
		expect(executor.consumeAbortSignal()).toBeNull();
	});
});
