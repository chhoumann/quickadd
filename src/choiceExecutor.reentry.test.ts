// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type IChoice from "./types/choices/IChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";
import type { ICommand } from "./types/macros/ICommand";
import { CommandType } from "./types/macros/CommandType";
import type { IUserScript } from "./types/macros/IUserScript";

const { scripts } = vi.hoisted(() => ({
	scripts: new Map<string, (params: unknown) => unknown>(),
}));

vi.mock("./gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("./gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
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
vi.mock("./utils/frontmatterPropertyLinks", () => ({
	getFocusedPropertyTarget: vi.fn(() => null),
}));
vi.mock("./utils/fileOpening", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getOpenFileOriginLeaf: vi.fn(() => null),
}));
vi.mock("./utils/userScript", async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadUserScript: async (command: IUserScript) => ({
		script: scripts.get(command.path),
		settings: undefined,
	}),
}));

const { ChoiceExecutor } = await import("./choiceExecutor");
const { StartupMacroEngine } = await import("./engine/StartupMacroEngine");
const { log } = await import("./logger/logManager");
const { default: ChoiceSuggester } = await import("./gui/suggesters/choiceSuggester");

let choices: IChoice[] = [];
const app = { workspace: { getActiveFile: () => null } } as never;
const plugin = {
	app,
	settings: { get choices() { return choices; } },
	getChoiceById: (id: string) => {
		const choice = choices.find((c) => c.id === id);
		if (!choice) throw new Error(`Choice ${id} not found`);
		return choice;
	},
	getChoiceByName: (name: string) => choices.find((c) => c.name === name),
} as never;

let ran: string[] = [];

type ScriptParams = {
	quickAddApi: {
		format(input: string): Promise<string>;
		executeChoice(name: string): Promise<void>;
	};
};

function script(name: string, body?: (params: ScriptParams) => unknown): ICommand {
	const path = `${name}.js`;
	scripts.set(path, async (params) => {
		ran.push(name);
		// Stops an unguarded cycle so a failing run ends instead of hanging.
		if (ran.length > 50) throw new Error("runaway recursion");
		return body?.(params as ScriptParams);
	});
	return { id: `${name}-step`, name, type: CommandType.UserScript, path, settings: {} } as IUserScript;
}

function runs(choice: IChoice): ICommand {
	return { id: `run-${choice.id}`, name: choice.name, type: CommandType.Choice, choiceId: choice.id } as ICommand;
}

function nested(choice: IChoice): ICommand {
	return { id: `nested-${choice.id}`, name: choice.name, type: CommandType.NestedChoice, choice } as ICommand;
}

function macro(name: string, commands: ICommand[] = []): IMacroChoice {
	return {
		id: name,
		name,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: { id: `${name}-macro`, name, commands },
	};
}

describe("ChoiceExecutor re-entry guard", () => {
	beforeEach(() => {
		scripts.clear();
		ran = [];
		choices = [];
	});

	it("refuses a macro whose Choice step runs itself", async () => {
		const a = macro("A");
		a.macro.commands = [script("a"), runs(a)];
		choices = [a];

		await expect(new ChoiceExecutor(app, plugin).execute(a)).rejects.toThrow(
			'Macro "A" calls itself: A -> A',
		);
		expect(ran).toEqual(["a"]);
	});

	it("names every choice in a longer cycle", async () => {
		const a = macro("A");
		const b = macro("B");
		a.macro.commands = [script("a"), runs(b)];
		b.macro.commands = [script("b"), runs(a)];
		choices = [a, b];

		await expect(new ChoiceExecutor(app, plugin).execute(a)).rejects.toThrow(
			'Macro "A" calls itself: A -> B -> A',
		);
		expect(ran).toEqual(["a", "b"]);
	});

	it("refuses a NestedChoice step that leads back to its macro", async () => {
		const a = macro("A");
		const inner = macro("Inner");
		inner.macro.commands = [script("inner"), runs(a)];
		a.macro.commands = [script("a"), nested(inner)];
		choices = [a];

		await expect(new ChoiceExecutor(app, plugin).execute(a)).rejects.toThrow(
			'Macro "A" calls itself: A -> Inner -> A',
		);
		expect(ran).toEqual(["a", "inner"]);
	});

	it("refuses a {{MACRO:}} that runs the macro it is part of", async () => {
		const a = macro("A", [script("a", ({ quickAddApi }) => quickAddApi.format("{{MACRO:A}}"))]);
		choices = [a];

		await expect(new ChoiceExecutor(app, plugin).execute(a)).rejects.toThrow(
			'Macro "A" calls itself: A -> A',
		);
		expect(ran).toEqual(["a"]);
	});

	it("refuses a script that runs the macro it is part of", async () => {
		const a = macro("A", [script("a", ({ quickAddApi }) => quickAddApi.executeChoice("A"))]);
		choices = [a];

		await expect(new ChoiceExecutor(app, plugin).execute(a)).rejects.toThrow(
			'Macro "A" calls itself: A -> A',
		);
		expect(ran).toEqual(["a"]);
	});

	it("still runs legitimate nesting and repeated calls, and recovers after a refused cycle", async () => {
		const c = macro("C", [script("c")]);
		const b = macro("B", [script("b"), runs(c)]);
		const a = macro("A", [script("a"), runs(b), runs(c), runs(b)]);
		const loop = macro("Loop");
		loop.macro.commands = [runs(b), runs(loop)];
		choices = [a, b, c, loop];
		const executor = new ChoiceExecutor(app, plugin);

		await expect(executor.execute(loop)).rejects.toThrow('Macro "Loop" calls itself');
		ran = [];
		await executor.execute(a);

		expect(ran).toEqual(["a", "b", "c", "c", "b", "c"]);
	});

	it("refuses a macro whose Obsidian-command step runs its own registered command", async () => {
		const a = macro("A", [
			script("a"),
			{ id: "cmd", name: "QuickAdd: A", type: CommandType.Obsidian, commandId: "quickadd:choice:A" } as ICommand,
		]);
		choices = [a];
		let dispatched: Promise<void> | undefined;
		const commandApp = {
			...(app as object),
			commands: {
				commands: { "quickadd:choice:A": {} },
				// What main.ts does for a registered choice: a fresh executor per run.
				executeCommandById: () => {
					dispatched = new ChoiceExecutor(commandApp, plugin).execute(a);
					dispatched.catch(() => undefined);
					return true;
				},
			},
		} as never;

		await new ChoiceExecutor(commandApp, plugin).execute(a);

		await expect(dispatched).rejects.toThrow('Macro "A" calls itself: A -> A');
		expect(ran).toEqual(["a"]);
	});

	it("hands the note named with current= to a choice its Obsidian-command step runs", async () => {
		let seen: string | undefined;
		const b = macro("B", [script("b", async ({ quickAddApi }) => {
			seen = await quickAddApi.format("{{FILENAMECURRENT}}");
		})]);
		const a = macro("A", [
			{ id: "cmd", name: "QuickAdd: B", type: CommandType.Obsidian, commandId: "quickadd:choice:B" } as ICommand,
		]);
		choices = [a, b];
		let dispatched: Promise<void> | undefined;
		const commandApp = {
			workspace: { getActiveFile: () => ({ path: "Active.md", basename: "Active" }) },
			commands: {
				commands: { "quickadd:choice:B": {} },
				executeCommandById: () => {
					dispatched = new ChoiceExecutor(commandApp, plugin).execute(b);
					return true;
				},
			},
		} as never;
		const executor = new ChoiceExecutor(commandApp, plugin);
		executor.setCurrentFile({ path: "Daily/Today.md", basename: "Today" } as never);

		await executor.execute(a);
		await dispatched;

		expect(seen).toBe("Today");
	});

	it("stops a startup macro that reaches itself before its prefix runs twice", async () => {
		const a = macro("A", [script("a"), runs(a_placeholder())]);
		function a_placeholder(): IMacroChoice { return { id: "A", name: "A" } as IMacroChoice; }
		a.runOnStartup = true;
		choices = [a];
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});

		await new StartupMacroEngine(app, plugin, choices, new ChoiceExecutor(app, plugin)).run();

		expect(ran).toEqual(["a"]);
		expect(logError).toHaveBeenCalledTimes(1);
		expect(String(logError.mock.calls[0][0])).toContain('Macro "A" calls itself: A -> A');
		logError.mockRestore();
	});

	it("refuses a choice picked from a folder that the choice itself opened", async () => {
		const a = macro("A");
		const folder: IMultiChoice = { id: "F", name: "F", type: "Multi", command: false, collapsed: false, choices: [a] };
		a.macro.commands = [script("a"), runs(folder)];
		choices = [a, folder];
		// The user picks the folder's first choice as soon as the picker opens.
		const open = vi.spyOn(ChoiceSuggester.prototype, "open").mockImplementation(function (this: InstanceType<typeof ChoiceSuggester>) {
			this.onChooseItem(this.getItems()[0], new MouseEvent("click"));
		});
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});

		await expect(new ChoiceExecutor(app, plugin).execute(a)).rejects.toThrow(
			'Macro "A" calls itself: A -> F -> A',
		);
		expect(ran).toEqual(["a"]);
		expect(open).toHaveBeenCalledTimes(1);
		open.mockRestore();
		logError.mockRestore();
	});

	it("does not mistake a choice a script started alongside for an ancestor", async () => {
		// The sibling B run holds until A has run B as its own step.
		let releaseB!: () => void;
		const bHeld = new Promise<void>((resolve) => (releaseB = resolve));
		let bStarted!: () => void;
		const bRunning = new Promise<void>((resolve) => (bStarted = resolve));
		let bCalls = 0;
		const b = macro("B", [
			script("b", () => {
				if (++bCalls > 1) return;
				bStarted();
				return bHeld;
			}),
		]);
		const a = macro("A", [script("a", () => bRunning), runs(b)]);
		const m = macro("M", [
			script("m", ({ quickAddApi }) =>
				Promise.all([
					quickAddApi.executeChoice("A").finally(releaseB),
					quickAddApi.executeChoice("B"),
				]),
			),
		]);
		choices = [m, a, b];

		await new ChoiceExecutor(app, plugin).execute(m);

		expect([...ran].sort()).toEqual(["a", "b", "b", "m"]);
	});
});
