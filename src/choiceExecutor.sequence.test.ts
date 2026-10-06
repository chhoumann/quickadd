import { beforeEach, describe, expect, it, vi } from "vitest";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import type IChoice from "./types/choices/IChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
import { CaptureChoice } from "./types/choices/CaptureChoice";
import { lowerNode } from "./v3/lower";
import { migrateChoice } from "./v3/migrate";
import type { Action, ActionNode } from "./v3/model";

const { state, runSteps, captured } = vi.hoisted(() => ({
	state: { actions: [] as ActionNode[], choices: [] as IChoice[] },
	runSteps: vi.fn(async () => {}),
	captured: [] as string[],
}));

vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("./main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("./quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("./settingsStore", () => ({
	settingsStore: {
		getState: () => ({
			onePageInputEnabled: false,
			ai: {},
			disableOnlineFeatures: true,
			migrations: { migrateToV3Actions: true },
			actions: state.actions,
			choices: state.choices,
		}),
	},
}));
vi.mock("./utils/frontmatterPropertyLinks", () => ({ getFocusedPropertyTarget: vi.fn(() => null) }));
vi.mock("./utils/fileOpening", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getOpenFileOriginLeaf: vi.fn(() => null),
}));
vi.mock("./v3/run/stepRunner", () => ({ runSteps }));
vi.mock("./engine/CaptureChoiceEngine", () => ({
	CaptureChoiceEngine: class {
		constructor(_app: unknown, _plugin: unknown, private choice: ICaptureChoice) {}
		async run() {
			captured.push(this.choice.captureTo);
		}
	},
}));

const { ChoiceExecutor } = await import("./choiceExecutor");

const app = { workspace: { getActiveFile: () => null } } as never;
const plugin = { app, settings: { choices: [] } } as never;

/** Stores the actions, and the choices they lower to as loading makes them. */
function store(...actions: Action[]): IChoice[] {
	state.actions = actions;
	state.choices = JSON.parse(JSON.stringify(actions.map(lowerNode)));
	return state.choices;
}

function captureAction(target: string): Action {
	const choice = new CaptureChoice("Log");
	choice.captureTo = target;
	return migrateChoice(choice).node as Action;
}

describe("ChoiceExecutor running a Macro", () => {
	beforeEach(() => {
		store();
		captured.length = 0;
		runSteps.mockClear();
	});

	it("runs a stored action that is more than one write through the step runner", async () => {
		const write = captureAction("Inbox.md");
		const action: Action = { ...write, steps: [...write.steps, { id: "wait", type: "wait", time: 0 }] };
		const [choice] = store(action) as IMacroChoice[];
		const executor = new ChoiceExecutor(app, plugin);

		await executor.execute(choice!);

		expect(runSteps).toHaveBeenCalledTimes(1);
		expect(runSteps).toHaveBeenCalledWith(action.steps, expect.objectContaining({ executor, action, chain: [choice] }));
		expect(captured).toEqual([]);
	});

	it("runs the steps as the builder left them, before a save stores them", async () => {
		const write = captureAction("Inbox.md");
		const action: Action = { ...write, steps: [...write.steps, { id: "wait", type: "wait", time: 0 }] };
		const [choice] = store(action) as IMacroChoice[];
		// The builder edits the choice; the stored action changes on the next save.
		(choice!.macro.commands[1] as unknown as { time: number }).time = 500;

		await new ChoiceExecutor(app, plugin).execute(choice!);

		expect(runSteps).toHaveBeenCalledWith(
			[action.steps[0], { id: "wait", type: "wait", time: 500 }],
			expect.objectContaining({ action: expect.objectContaining({ id: action.id }) }),
		);
	});

	it("runs a Macro with no stored action on the macro engine", async () => {
		const write = captureAction("Inbox.md");
		const choice = lowerNode({ ...write, steps: [...write.steps, { id: "wait", type: "wait", time: 0 }] }) as IMacroChoice;

		await new ChoiceExecutor(app, plugin).execute(choice);

		expect(runSteps).not.toHaveBeenCalled();
		expect(captured).toEqual(["Inbox.md"]);
	});

	it("runs a stored action that is one write, kept as a Macro, on the macro engine", async () => {
		const action: Action = { ...captureAction("Inbox.md"), provenance: { migratedFrom: "Macro" } };
		const [choice] = store(action) as IMacroChoice[];
		expect(choice!.type).toBe("Macro");

		await new ChoiceExecutor(app, plugin).execute(choice!);

		expect(runSteps).not.toHaveBeenCalled();
		expect(captured).toEqual(["Inbox.md"]);
	});
});
