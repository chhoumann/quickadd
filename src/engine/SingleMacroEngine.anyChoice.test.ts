import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import type { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { log } from "../logger/logManager";
import { SingleMacroEngine } from "./SingleMacroEngine";

const { macroRun } = vi.hoisted(() => ({ macroRun: vi.fn() }));

vi.mock("./MacroChoiceEngine", () => ({
	MacroChoiceEngine: vi.fn(function MacroChoiceEngineMock(this: unknown, _app: unknown, _plugin: unknown, choice: IChoice) {
		return {
			run: () => macroRun(choice.name),
			getOutput: () => `${choice.name} output`,
			params: { variables: {} },
		};
	}),
}));
vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));

const choice = (name: string, type: IChoice["type"], id = name): IChoice =>
	({ id, name, type, command: false }) as IChoice;

const macro = (name: string): IMacroChoice =>
	({ ...choice(name, "Macro"), runOnStartup: false, macro: { id: name, name, commands: [] } }) as IMacroChoice;

describe("SingleMacroEngine on a choice that is not a macro", () => {
	let executor: IChoiceExecutor;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(log, "logError").mockImplementation(() => {});
		executor = createChoiceExecutor();
		let recorded = 0;
		executor.noteEndedOn = async (run) => {
			const seen = recorded;
			await run();
			return recorded === seen ? null : executor.runNote ?? null;
		};
		vi.mocked(executor.execute).mockImplementation((ran: IChoice) => {
			executor.runNote = { path: `notes/${ran.name}.md` } as TFile;
			recorded++;
			return Promise.resolve();
		});
	});

	const engine = (choices: IChoice[]) =>
		new SingleMacroEngine({} as App, {} as QuickAdd, choices, executor);

	it("runs a Capture through the executor inside the caller's chain and gives back the note it wrote", async () => {
		const capture = choice("Log", "Capture");
		const caller = choice("Daily", "Template");

		await expect(engine([capture]).runAndGetOutput("log", undefined, [caller])).resolves.toBe("notes/Log.md");
		expect(executor.execute).toHaveBeenCalledWith(capture, [caller]);
	});

	it("finds one inside a folder, and gives back nothing when it wrote no note", async () => {
		vi.mocked(executor.execute).mockResolvedValue(undefined);
		const folder = { ...choice("Folder", "Multi"), choices: [choice("New note", "Template")] } as IChoice;

		await expect(engine([folder]).runAndGetOutput("New note")).resolves.toBe("");
		expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({ name: "New note" }), []);
	});

	it("gives back nothing, and keeps the run note, when the choice wrote none after an earlier step did", async () => {
		const earlier = { path: "notes/Earlier.md" } as TFile;
		executor.runNote = earlier;
		vi.mocked(executor.execute).mockResolvedValue(undefined);

		await expect(engine([choice("Open inbox", "Capture")]).runAndGetOutput("Open inbox")).resolves.toBe("");
		expect(executor.runNote).toBe(earlier);
	});

	it("leaves the run note in place while the choice runs, so {{NOTE}} inside it sees the outer note", async () => {
		const earlier = { path: "notes/Earlier.md" } as TFile;
		executor.runNote = earlier;
		let seenInside: TFile | null | undefined;
		vi.mocked(executor.execute).mockImplementation(() => {
			seenInside = executor.runNote;
			return Promise.resolve();
		});

		await engine([choice("Append", "Capture")]).runAndGetOutput("Append");
		expect(seenInside).toBe(earlier);
	});

	it("refuses export access on it", async () => {
		await expect(engine([choice("Log", "Capture")]).runAndGetOutput("Log::entry")).rejects.toThrow(
			"'Log' is not a macro, so it has no exports.",
		);
		expect(executor.execute).not.toHaveBeenCalled();
	});

	it("refuses a name that matches choices of different types when case is ignored", async () => {
		const choices = [choice("Log", "Capture"), choice("LOG", "Template")];

		await expect(engine(choices).runAndGetOutput("log")).rejects.toThrow("Ambiguous reference 'log'");
		expect(executor.execute).not.toHaveBeenCalled();
	});

	it("still runs a macro of that name rather than another choice", async () => {
		const choices = [choice("Log", "Capture"), macro("Log")];

		await expect(engine(choices).runAndGetOutput("Log")).resolves.toBe("Log output");
		expect(macroRun).toHaveBeenCalledWith("Log");
		expect(executor.execute).not.toHaveBeenCalled();
	});

	it("says when no choice has the name", async () => {
		await expect(engine([choice("Log", "Capture")]).runAndGetOutput("Journal")).rejects.toThrow(
			"There is no choice named 'Journal'.",
		);
	});
});
