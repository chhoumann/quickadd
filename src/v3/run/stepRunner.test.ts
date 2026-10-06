import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, TFile } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type { IUserScript } from "../../types/macros/IUserScript";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import type { ChoiceChain } from "../../engine/choiceChain";
import type { MacroAbortError } from "../../errors/MacroAbortError";
import { createPreparedChoiceInputState } from "../../preflight/preparedChoiceInputs";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { migrateChoice } from "../migrate";
import type { Action, Step } from "../model";
import { RUN_NOTE } from "../model";

const { scripts, insertLink, copyLink, openFileMock, templater, overwrite } = vi.hoisted(() => ({
	scripts: new Map<string, (params: { variables: Record<string, unknown> }) => unknown>(),
	insertLink: vi.fn(async () => {}),
	copyLink: vi.fn(async () => {}),
	openFileMock: vi.fn(async () => ({})),
	templater: { installed: true },
	overwrite: vi.fn(async () => false),
}));

vi.mock("../../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../../gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("../../main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("../../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("../../settingsStore", () => ({
	settingsStore: { getState: () => ({ ai: {}, disableOnlineFeatures: true, showInputCancellationNotification: true }) },
}));
vi.mock("../../utils/userScript", async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadUserScript: async (command: IUserScript) => ({ script: scripts.get(command.path), settings: undefined }),
}));
vi.mock("../../engine/choiceFileActions", async (importOriginal) => ({
	...(await importOriginal<object>()),
	insertChoiceFileLink: insertLink,
	copyChoiceFileLink: copyLink,
}));
vi.mock("../../utils/fileOpening", async (importOriginal) => ({
	...(await importOriginal<object>()),
	openFile: openFileMock,
}));
vi.mock("../../utils/templaterIntegration", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTemplaterPlugin: () => (templater.installed ? {} : null),
	overwriteTemplaterOnce: overwrite,
}));

const { MacroChoiceEngine } = await import("../../engine/MacroChoiceEngine");
const { runSteps } = await import("./stepRunner");

function fileAt(path: string): TFile {
	return Object.assign(new TFile(), { path, name: path, basename: path.replace(/\.md$/, ""), extension: "md" });
}

/** An executor whose Capture runs record writing to their target. */
class FakeExecutor implements IChoiceExecutor {
	variables = new Map<string, unknown>();
	preparedInputs = createPreparedChoiceInputState();
	runNote: TFile | null = null;
	focusedProperty = null;
	ran: { choice: IChoice; chain: ChoiceChain }[] = [];
	private pendingAbort: MacroAbortError | null = null;
	prepareMacroInputs = vi.fn(async () => {});
	async execute(choice: IChoice, chain: ChoiceChain = []) {
		this.ran.push({ choice, chain });
		this.runNote = fileAt((choice as ICaptureChoice).captureTo);
	}
	signalAbort(error: MacroAbortError) {
		this.pendingAbort = error;
	}
	consumeAbortSignal() {
		const abort = this.pendingAbort;
		this.pendingAbort = null;
		return abort;
	}
}

const app = { workspace: { getActiveFile: () => null }, vault: {} } as never;
const plugin = { app, settings: { choices: [] }, getChoiceById: () => { throw new Error("not found"); } } as never;

function captureTo(target: string): Action {
	const choice = new CaptureChoice("Log");
	choice.captureTo = target;
	return migrateChoice(choice).node as Action;
}

let seen: unknown[] = [];

function script(name: string, run: (params: { variables: Record<string, unknown> }) => unknown = () => seen.push(name)): Step {
	scripts.set(`${name}.js`, run);
	return { id: name, name, type: "runScript", path: `${name}.js`, settings: {} };
}

async function run(steps: Step[], executor = new FakeExecutor(), action: Action = { ...captureTo("Inbox.md"), name: "Action", steps }) {
	const choice = { id: action.id, name: action.name, type: "Macro", command: false, runOnStartup: false, macro: { id: action.id, name: action.name, commands: [] } } as IMacroChoice;
	const chain: ChoiceChain = [choice];
	const macroEngine = new MacroChoiceEngine(app, plugin, choice, executor, executor.variables, undefined, undefined, null, chain);
	await runSteps(steps, { app, plugin, executor, action, chain, originLeaf: null, macroEngine });
	return { executor, chain };
}

const notices = () => (Notice as unknown as { instances: { message: string }[] }).instances.map((notice) => notice.message);

describe("runSteps", () => {
	beforeEach(() => {
		scripts.clear();
		seen = [];
		templater.installed = true;
		vi.clearAllMocks();
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;
	});

	it("runs a write group as its Capture through the executor, which sets the run note", async () => {
		const action = captureTo("Inbox.md");
		const write = action.steps[0]!;
		const steps = [write, script("after", () => seen.push(executor.runNote?.path))];
		const executor = new FakeExecutor();
		const { chain } = await run(steps, executor, { ...action, steps });
		expect(executor.ran).toHaveLength(1);
		expect(executor.ran[0]!.choice).toMatchObject({ id: `${action.id}:choice`, type: "Capture", captureTo: "Inbox.md" });
		expect(executor.ran[0]!.chain).toBe(chain);
		expect(seen).toEqual(["Inbox.md"]);
	});

	it("inserts a link to {{NOTE}} into the active note and copies it", async () => {
		const executor = new FakeExecutor();
		executor.runNote = fileAt("Inbox.md");
		await run([{ id: "link", type: "link", link: RUN_NOTE, insert: { placement: "newLine", requireActiveFile: true }, copyToClipboard: true }], executor);
		expect(insertLink).toHaveBeenCalledWith(app, executor.runNote, expect.objectContaining({ enabled: true, placement: "newLine", destination: { type: "activeFile" } }), null);
		expect(copyLink).toHaveBeenCalledWith(executor.runNote);
	});

	it("runs Templater over the run note, and skips without a word when Templater is not installed", async () => {
		const executor = new FakeExecutor();
		executor.runNote = fileAt("Inbox.md");
		await run([{ id: "templater", type: "templater", note: RUN_NOTE }], executor);
		expect(overwrite).toHaveBeenCalledWith(app, executor.runNote);

		overwrite.mockClear();
		templater.installed = false;
		await run([{ id: "templater", type: "templater", note: RUN_NOTE }, script("after")], new FakeExecutor());
		expect(overwrite).not.toHaveBeenCalled();
		expect(notices()).toEqual([]);
		expect(seen).toEqual(["after"]);
	});

	it("opens the run note with the step's view mode", async () => {
		const executor = new FakeExecutor();
		executor.runNote = fileAt("Inbox.md");
		await run([{ id: "open", type: "open", note: RUN_NOTE, location: "reuse", direction: "vertical", mode: "preview", focus: true }], executor);
		expect(openFileMock).toHaveBeenCalledWith(app, executor.runNote, {
			location: "reuse", direction: "vertical", mode: "preview", focus: true, originLeaf: null,
		});
	});

	it("runs a script step on the macro engine, and a later step sees the variables it set", async () => {
		const executor = new FakeExecutor();
		await run([
			script("sets", (params) => { params.variables.greeting = "hello"; }),
			script("reads", (params) => seen.push(params.variables.greeting)),
		], executor);
		expect(seen).toEqual(["hello"]);
		expect(executor.variables.get("greeting")).toBe("hello");
	});

	it.each([
		["yes", ["then"]],
		["no", ["else"]],
	])("runs the branch of an if step its condition picks (answer %s)", async (answer, ran) => {
		await run([
			script("sets", (params) => { params.variables.answer = answer; }),
			{
				id: "if",
				type: "if",
				condition: { mode: "variable", variableName: "answer", operator: "equals", valueType: "string", expectedValue: "yes" },
				thenSteps: [script("then")],
				elseSteps: [script("else")],
			},
			script("after", () => seen.push("after")),
		]);
		expect(seen).toEqual([...ran, "after"]);
	});

	it("stops at a refusal: a link to {{NOTE}} before any write refuses and the next step does not run", async () => {
		const executor = new FakeExecutor();
		await run([
			script("first"),
			{ id: "link", type: "link", link: RUN_NOTE, copyToClipboard: true },
			script("third"),
		], executor);
		expect(seen).toEqual(["first"]);
		expect(copyLink).not.toHaveBeenCalled();
		expect(notices()).toEqual(["Action: nothing has written a note yet, so there is no {{NOTE}} to link."]);
		expect(executor.consumeAbortSignal()?.message).toBe("Action: nothing has written a note yet, so there is no {{NOTE}} to link.");
	});

	it("stops the whole run when a script aborts inside an if branch", async () => {
		const executor = new FakeExecutor();
		await run([
			{
				id: "if",
				type: "if",
				condition: { mode: "variable", variableName: "missing", operator: "isFalsy", valueType: "string" },
				thenSteps: [script("aborts", (params) => (params as unknown as { abort: (message: string) => never }).abort("stop here"))],
				elseSteps: [],
			},
			script("after"),
		], executor);
		expect(seen).toEqual([]);
		expect(executor.consumeAbortSignal()?.message).toBe("stop here");
	});
});
