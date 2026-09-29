import { createSelectionFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const { promptMock, factoryMock } = vi.hoisted(() => {
	const promptMock = vi.fn();
	return {
		promptMock,
		factoryMock: vi.fn(() => ({ Prompt: promptMock, PromptWithContext: promptMock })),
	};
});

vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory = factoryMock;
	},
}));
vi.mock("../quickAddSettingsTab", () => ({ QuickAddSettingsTab: class {} }));
vi.mock("../main", () => ({ __esModule: true, default: class QuickAddMock {} }));
vi.mock("obsidian-dataview", async () => (await import("../../tests/helpers/formatters/mocks")).obsidiandataviewMock());

function createFormatter(variables = new Map<string, unknown>()) {
	const app = {
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			getActiveFile: vi.fn().mockReturnValue(null),
		},
	} as unknown as App;
	const choiceExecutor = { ...createChoiceExecutor(), execute: vi.fn(), variables } as any;
	return new CaptureChoiceFormatter(app, createSelectionFormatterPlugin(), choiceExecutor);
}

describe("Capture: one entry per line", () => {
	beforeEach(() => {
		promptMock.mockReset();
		factoryMock.mockClear();
	});

	it("writes the task format once per non-blank line and asks every other question once", async () => {
		promptMock
			.mockResolvedValueOnce("Buy milk\n\n  Call the plumber  \nBook dentist")
			.mockResolvedValueOnce("home");

		const result = await createFormatter().formatContentOnly(
			"- [ ] {{VALUE}} #{{VALUE:context}}\n",
			{ eachLine: true },
		);

		expect(result).toBe(
			"- [ ] Buy milk #home\n- [ ] Call the plumber #home\n- [ ] Book dentist #home\n",
		);
		expect(promptMock).toHaveBeenCalledTimes(2);
		// The {{VALUE}} prompt opens as a multi-line box by default.
		expect(factoryMock).toHaveBeenNthCalledWith(1, "multiline");
	});

	it("splits a value passed in from the API, URI, or CLI", async () => {
		const variables = new Map<string, unknown>([["value", "first\nsecond"]]);

		const result = await createFormatter(variables).formatContentOnly("{{VALUE}}", { eachLine: true });

		expect(result).toBe("first\nsecond");
		expect(variables.get("value")).toBe("first\nsecond");
		expect(promptMock).not.toHaveBeenCalled();
	});

	it("leaves a multi-line answer whole when the option is off", async () => {
		promptMock.mockResolvedValueOnce("one\ntwo");

		const result = await createFormatter().formatContentOnly("- {{VALUE}}\n");

		expect(result).toBe("- one\ntwo\n");
		expect(factoryMock).toHaveBeenCalledWith(undefined);
	});
});
