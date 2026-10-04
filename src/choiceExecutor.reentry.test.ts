import { beforeEach, describe, expect, it, vi } from "vitest";
import type IChoice from "./types/choices/IChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
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
const { SingleMacroEngine } = await import("./engine/SingleMacroEngine");

let choices: IChoice[] = [];
const app = { workspace: { getActiveFile: () => null } } as never;
const plugin = {
	settings: { get choices() { return choices; } },
	getChoiceById: (id: string) => {
		const choice = choices.find((c) => c.id === id);
		if (!choice) throw new Error(`Choice ${id} not found`);
		return choice;
	},
} as never;

let ran: string[] = [];

function script(name: string, body?: () => unknown): ICommand {
	const path = `${name}.js`;
	scripts.set(path, async () => {
		ran.push(name);
		// Stops an unguarded cycle so a failing run ends instead of hanging.
		if (ran.length > 50) throw new Error("runaway recursion");
		return body?.();
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
		const executor = new ChoiceExecutor(app, plugin);
		const a = macro("A");
		// What CompleteFormatter.getMacroValue does for {{MACRO:A}}.
		a.macro.commands = [
			script("a", () =>
				new SingleMacroEngine(app, plugin, choices, executor).runAndGetOutput("A"),
			),
		];
		choices = [a];

		await expect(executor.execute(a)).rejects.toThrow('Macro "A" calls itself: A -> A');
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
});
