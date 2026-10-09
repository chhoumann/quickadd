import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { QuickAddTriggerContext } from "./types/QuickAddTriggerContext";

vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("./main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("./quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("./settingsStore", () => ({
	settingsStore: { getState: () => ({ onePageInputEnabled: false, ai: {}, disableOnlineFeatures: true }) },
}));
vi.mock("./engine/runTemplateFromFolder", () => ({ runTemplateFromFolder: vi.fn() }));
vi.mock("./utils/frontmatterPropertyLinks", () => ({ getFocusedPropertyTarget: vi.fn(() => null) }));
vi.mock("./utils/fileOpening", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getOpenFileOriginLeaf: vi.fn(() => null),
}));
const seen = vi.hoisted(() => ({ contexts: [] as Array<QuickAddTriggerContext | null | undefined> }));
vi.mock("./engine/CaptureChoiceEngine", () => ({
	CaptureChoiceEngine: class {
		constructor(_app: unknown, _plugin: unknown, _choice: unknown, private executor: { triggerContext?: QuickAddTriggerContext | null }) {}
		async run() {
			seen.contexts.push(this.executor.triggerContext);
		}
	},
}));

const { ChoiceExecutor } = await import("./choiceExecutor");
const { withDispatch } = await import("./engine/choiceChain");

describe("ChoiceExecutor.setCurrentFile", () => {
	const active = { path: "Active.md" } as TFile;
	const named = { path: "Daily/Today.md" } as TFile;
	const capture = { id: "c", name: "Capture", type: "Capture" } as never;
	const app = { workspace: { getActiveFile: () => active } } as never;

	it("fixes the named note as the run's current note instead of the active tab", async () => {
		seen.contexts.length = 0;
		const executor = new ChoiceExecutor(app, {} as never);
		executor.setCurrentFile(named);
		expect(executor.triggerContext).toEqual({ activeFile: named, named: true });

		await executor.execute(capture);

		expect(seen.contexts).toEqual([{ activeFile: named, named: true }]);
	});

	it("fixes none as no current note", async () => {
		seen.contexts.length = 0;
		const executor = new ChoiceExecutor(app, {} as never);
		executor.setCurrentFile(null);

		await executor.execute(capture);

		expect(seen.contexts).toEqual([{ activeFile: null, named: true }]);
	});

	it("reads the active tab when no note was named", async () => {
		seen.contexts.length = 0;
		await new ChoiceExecutor(app, {} as never).execute(capture);
		expect(seen.contexts).toEqual([{ activeFile: active }]);
	});

	it("reads the active tab again on the run after the one the note was named for", async () => {
		seen.contexts.length = 0;
		const executor = new ChoiceExecutor(app, {} as never);
		executor.setCurrentFile(named);

		await executor.execute(capture);
		await executor.execute(capture);

		expect(seen.contexts).toEqual([{ activeFile: named, named: true }, { activeFile: active }]);
	});

	it("reads the active tab on the run after a launcher run that was handed the named note", async () => {
		seen.contexts.length = 0;
		const executor = new ChoiceExecutor(app, {} as never);
		executor.setCurrentFile(named);

		await executor.executeWithFocusedProperty(capture, null, executor.triggerContext);
		await executor.execute(capture);

		expect(seen.contexts).toEqual([{ activeFile: named, named: true }, { activeFile: active }]);
	});
});

describe("ChoiceExecutor built inside a command dispatch", () => {
	const active = { path: "Active.md" } as TFile;
	const named = { path: "Daily/Today.md" } as TFile;
	const capture = { id: "c", name: "Capture", type: "Capture" } as never;
	const app = { workspace: { getActiveFile: () => active } } as never;

	it("uses the note the dispatching run named", async () => {
		seen.contexts.length = 0;
		const executor = withDispatch({ chain: [], currentNote: named }, () => new ChoiceExecutor(app, {} as never));

		await executor.execute(capture);

		expect(seen.contexts).toEqual([{ activeFile: named, named: true }]);
	});

	it("uses no current note when the dispatching run named none", async () => {
		seen.contexts.length = 0;
		const executor = withDispatch({ chain: [], currentNote: null }, () => new ChoiceExecutor(app, {} as never));

		await executor.execute(capture);

		expect(seen.contexts).toEqual([{ activeFile: null, named: true }]);
	});

	it("reads the active tab after a run the self-call guard stopped", async () => {
		seen.contexts.length = 0;
		const other = { id: "c2", name: "Other capture", type: "Capture" } as never;
		const executor = withDispatch({ chain: [capture], currentNote: named }, () => new ChoiceExecutor(app, {} as never));

		await expect(executor.execute(capture)).rejects.toThrow("calls itself");
		await executor.execute(other);

		expect(seen.contexts).toEqual([{ activeFile: active }]);
	});

	it("reads the active tab when the dispatching run did not name a note", async () => {
		seen.contexts.length = 0;
		const executor = withDispatch({ chain: [] }, () => new ChoiceExecutor(app, {} as never));

		await executor.execute(capture);

		expect(seen.contexts).toEqual([{ activeFile: active }]);
	});
});
