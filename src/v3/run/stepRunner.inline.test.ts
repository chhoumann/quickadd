import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type IChoice from "../../types/choices/IChoice";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { lowerNode } from "../lower";
import { migrateChoice } from "../migrate";
import type { Action, ActionNode } from "../model";
import { RUN_NOTE } from "../model";

// An inline action runs through the executor with its own steps: a link inside
// it is the step runner's, which the macro engine cannot run.
const { state, copyLink } = vi.hoisted(() => ({
	state: { actions: [] as ActionNode[], choices: [] as IChoice[] },
	copyLink: vi.fn(async () => {}),
}));

vi.mock("../../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../../gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("../../main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("../../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("../../settingsStore", () => ({
	settingsStore: {
		getState: () => ({
			onePageInputEnabled: false,
			ai: {},
			disableOnlineFeatures: true,
			showInputCancellationNotification: true,
			migrations: { migrateToV3Actions: true },
			actions: state.actions,
			choices: state.choices,
		}),
	},
}));
vi.mock("../../utils/frontmatterPropertyLinks", () => ({ getFocusedPropertyTarget: vi.fn(() => null) }));
vi.mock("../../utils/fileOpening", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getOpenFileOriginLeaf: vi.fn(() => null),
}));
vi.mock("../../engine/choiceFileActions", async (importOriginal) => ({
	...(await importOriginal<object>()),
	copyChoiceFileLink: copyLink,
}));
vi.mock("../../engine/CaptureChoiceEngine", () => ({
	// Writes nothing; records its target as the note it wrote, as a capture does.
	CaptureChoiceEngine: class {
		constructor(_app: unknown, _plugin: unknown, private choice: ICaptureChoice, private executor: IChoiceExecutor) {}
		async run() {
			const file = Object.assign(new TFile(), { path: this.choice.captureTo, basename: this.choice.captureTo.replace(/\.md$/, ""), extension: "md" });
			this.executor.recordExecutionResult?.({ status: "success", file, effect: "appended" } as never);
		}
	},
}));

const { ChoiceExecutor } = await import("../../choiceExecutor");

const app = { workspace: { getActiveFile: () => null } } as never;
const plugin = { app, settings: { choices: [] }, getChoiceById: () => { throw new Error("not found"); } } as never;

function captureAction(target: string): Action {
	const choice = new CaptureChoice("Log");
	choice.captureTo = target;
	return migrateChoice(choice).node as Action;
}

describe("an inline action in a sequence", () => {
	beforeEach(() => {
		copyLink.mockClear();
	});

	it("runs its own steps, so a link inside it links the run note", async () => {
		const write = captureAction("Inbox.md");
		const inline: Action = {
			kind: "action",
			id: "inline",
			name: "Share it",
			show: { command: false },
			onePageInput: "never",
			steps: [{ id: "link", type: "link", link: RUN_NOTE, copyToClipboard: true }],
		};
		const action: Action = { ...write, steps: [...write.steps, { id: "share", name: "Share it", type: "inlineAction", node: inline }] };
		state.actions = [action];
		state.choices = JSON.parse(JSON.stringify([lowerNode(action)]));

		await new ChoiceExecutor(app, plugin).execute(state.choices[0]!);

		expect(copyLink).toHaveBeenCalledTimes(1);
		expect(copyLink).toHaveBeenCalledWith(expect.objectContaining({ path: "Inbox.md" }));
	});
});
