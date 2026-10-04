import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	prompt: vi.fn(async (..._args: unknown[]) => "answer"),
	datePrompt: vi.fn(async (..._args: unknown[]) => ""),
}));

vi.mock("obsidian", async () => (await import("../../tests/helpers/formatters/mocks")).obsidianMock());
vi.mock("../gui/InputPrompt", () => ({
	default: class {
		factory() {
			return { Prompt: mocks.prompt };
		}
	},
}));
vi.mock("../gui/GenericSuggester/genericSuggester", () => ({ default: {} }));
vi.mock("../gui/GenericInputPrompt/GenericInputPrompt", () => ({ default: { Prompt: mocks.prompt } }));
vi.mock("../gui/InputSuggester/inputSuggester", () => ({ default: {} }));
vi.mock("../gui/MultiSuggester/multiSuggester", () => ({ default: {} }));
vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", () => ({ default: { Prompt: mocks.datePrompt } }));
vi.mock("../gui/MathModal", () => ({ MathModal: {} }));
vi.mock("../parsers/NLDParser", () => ({ NLDParser: { getNattyParser: () => ({}) } }));
vi.mock("../logger/logManager", () => ({
	log: { logMessage: vi.fn(), logWarning: vi.fn(), logError: vi.fn() },
}));

import { CompleteFormatter } from "./completeFormatter";
import { settingsStore } from "../settingsStore";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import type IChoice from "../types/choices/IChoice";
import type { Action, InputOverride } from "../v3/model";

const app = {
	workspace: { getActiveFile: () => null, getActiveViewOfType: () => null },
	fileManager: { generateMarkdownLink: () => "" },
} as never;
const plugin = { settings: { globalVariables: {}, inputPrompt: "single-line" } } as never;

function withOverrides(inputs: Record<string, InputOverride>) {
	const action: Action = { kind: "action", id: "log", name: "Log", steps: [], show: { command: false }, inputs };
	settingsStore.setState({ actions: [action] });
}

function formatterFor(choiceId: string, executor = createChoiceExecutor()) {
	const formatter = new CompleteFormatter(app, plugin, executor);
	formatter.choiceChain = [{ id: choiceId, name: "Log", type: "Capture" } as IChoice];
	return formatter;
}

const promptCall = (calls: unknown[][]) => {
	const args = calls.at(-1);
	if (!args) throw new Error("no prompt was opened");
	return { title: args[1], options: args.at(-1) as { optional?: boolean } };
};

beforeEach(() => {
	mocks.prompt.mockClear();
	mocks.datePrompt.mockClear();
	settingsStore.setState({ actions: [] });
});

describe("an action's input override at prompt time", () => {
	it("titles a named value's prompt with the override's label and lets it be left empty", async () => {
		withOverrides({ Title: { label: "What happened?", optional: true } });

		await formatterFor("log").formatFileContent("- {{VALUE:Title}}");

		expect(promptCall(mocks.prompt.mock.calls)).toMatchObject({ title: "What happened?", options: { optional: true } });
	});

	it("applies to the {{VALUE}} prompt and a date prompt too", async () => {
		withOverrides({ value: { label: "Entry" }, Due: { label: "When is it due?", optional: true } });
		const formatter = formatterFor("log");

		expect(await formatter.formatFileContent("{{VALUE}} due {{VDATE:Due,YYYY-MM-DD}}")).toBe("answer due ");

		expect(promptCall(mocks.prompt.mock.calls).title).toBe("Entry");
		expect(promptCall(mocks.datePrompt.mock.calls).title).toBe("When is it due?");
	});

	it("leaves another choice's prompts as their placeholders say", async () => {
		withOverrides({ Title: { label: "What happened?" } });

		await formatterFor("other").formatFileContent("- {{VALUE:Title}}");

		expect(promptCall(mocks.prompt.mock.calls).title).toBe("Title");
	});

	it("leaves a run that was given the value alone", async () => {
		withOverrides({ Title: { label: "What happened?", default: "Nothing" } });
		const executor = { ...createChoiceExecutor(), interactive: false };
		executor.variables.set("Title", "Shipped it");

		expect(await formatterFor("log", executor).formatFileContent("- {{VALUE:Title}}")).toBe("- Shipped it");
		expect(mocks.prompt).not.toHaveBeenCalled();
	});
});
