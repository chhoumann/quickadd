import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IAIAssistantCommand } from "../types/macros/QuickCommands/IAIAssistantCommand";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { RefusalError } from "../errors/RefusalError";

const { state } = vi.hoisted(() => ({
	state: { disableOnlineFeatures: false, ai: { providers: [] as unknown[] } },
}));

vi.mock("../settingsStore", () => ({ settingsStore: { getState: () => state } }));
vi.mock("../ai/AIAssistant", () => ({ runAIAssistant: vi.fn() }));
vi.mock("../formatters/completeFormatter", () => ({ CompleteFormatter: class {} }));
vi.mock("../quickAddInstance", () => ({ getQuickAddInstance: vi.fn() }));
vi.mock("../ai/aiHelpers", () => ({ resolveModel: vi.fn(() => undefined) }));

const { executeMacroAI, pickMacroModel } = await import("./macroAI");

const app = {} as App;
const choice = { name: "Summarize" } as IMacroChoice;
const command = { id: "ai", model: "gpt-9" } as IAIAssistantCommand;

async function refusal(run: Promise<unknown>): Promise<string> {
	const error = await run.catch((e: unknown) => e);
	expect(error).toBeInstanceOf(RefusalError);
	return (error as Error).message;
}

describe("AI steps that are not set up", () => {
	beforeEach(() => {
		state.disableOnlineFeatures = false;
		state.ai.providers = [];
	});

	it("refuses with online features off", async () => {
		state.disableOnlineFeatures = true;
		expect(await refusal(executeMacroAI(app, choice, createChoiceExecutor(), [], command, vi.fn())))
			.toBe("Online features are off, so the AI request was not sent. Turn off \"Disable AI & online features\" in QuickAdd's settings.");
	});

	it("refuses a model no provider offers", async () => {
		expect(await refusal(executeMacroAI(app, choice, createChoiceExecutor(), [], command, vi.fn())))
			.toBe("No AI provider offers the model gpt-9, so the AI request was not sent. Pick a model on the step's row.");
	});

	it("refuses to ask for a model when none is set up", async () => {
		expect(await refusal(pickMacroModel(app, createChoiceExecutor())))
			.toBe("No AI models are set up, so the AI request was not sent. Add a provider with models in QuickAdd's AI settings.");
	});
});
