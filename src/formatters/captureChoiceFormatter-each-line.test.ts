import { createSelectionFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

// #1996: Capture "One entry per line". Macros and inline scripts running once
// is covered in native Obsidian by tests/e2e/capture-each-line.test.ts.
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

function createFormatter(variables = new Map<string, unknown>()) {
	const app = {
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			getActiveFile: vi.fn().mockReturnValue(null),
		},
	} as unknown as App;
	const choiceExecutor = { ...createChoiceExecutor(), execute: vi.fn(), variables } as never;
	return new CaptureChoiceFormatter(app, createSelectionFormatterPlugin(), choiceExecutor);
}

describe("Capture: one entry per line", () => {
	beforeEach(() => {
		promptMock.mockReset();
		factoryMock.mockClear();
	});

	it("writes the format once per non-blank, trimmed line and asks every other question once", async () => {
		promptMock
			.mockResolvedValueOnce("Buy milk\n\n  Call the plumber  \r\nBook dentist")
			.mockResolvedValueOnce("home");
		const formatter = createFormatter();
		const math = vi.spyOn(formatter as unknown as { promptForMathValue: () => Promise<string> }, "promptForMathValue")
			.mockResolvedValue("x^2");

		const result = await formatter.formatContentOnly(
			"- [ ] {{VALUE}} #{{VALUE:context}} ${{MVALUE}}$\n",
			{ eachLine: true },
		);

		expect(result).toBe(
			"- [ ] Buy milk #home $x^2$\n- [ ] Call the plumber #home $x^2$\n- [ ] Book dentist #home $x^2$\n",
		);
		expect(promptMock).toHaveBeenCalledTimes(2);
		expect(math).toHaveBeenCalledTimes(1);
		// The {{VALUE}} prompt opens as a multi-line box unless the token sets a type.
		expect(factoryMock).toHaveBeenNthCalledWith(1, "multiline");
	});

	it("joins entries whose format has no line break of its own", async () => {
		promptMock.mockResolvedValueOnce("a\nb");

		expect(await createFormatter().formatContentOnly("* {{VALUE|case:upper}}", { eachLine: true })).toBe("* A\n* B");
	});

	it("trims a single line too, and writes nothing for only blank lines", async () => {
		promptMock.mockResolvedValueOnce("\n  Buy milk  \n").mockResolvedValueOnce(" \n\t\n");

		expect(await createFormatter().formatContentOnly("- [ ] {{VALUE}}\n", { eachLine: true })).toBe("- [ ] Buy milk\n");
		// An empty capture leaves the note as it is.
		expect(await createFormatter().formatContentOnly("- [ ] {{VALUE}}\n", { eachLine: true })).toBe("");
	});

	it("splits on a carriage return alone, as old Mac text and some clipboards send it", async () => {
		promptMock.mockResolvedValueOnce("first\rsecond");

		expect(await createFormatter().formatContentOnly("- {{VALUE}}\n", { eachLine: true })).toBe("- first\n- second\n");
	});

	it("writes the token's default for an empty answer, and nothing when the default is optional", async () => {
		promptMock.mockResolvedValueOnce("").mockResolvedValueOnce(" \n ");

		expect(await createFormatter().formatContentOnly("- {{VALUE|default:Inbox}}\n", { eachLine: true })).toBe("- Inbox\n");
		expect(await createFormatter().formatContentOnly("- {{VALUE|default:Inbox|optional}}\n", { eachLine: true })).toBe("");
	});

	it("splits a capture into a Canvas text card, which formats through formatContentWithFile", async () => {
		promptMock.mockResolvedValueOnce("a\nb");
		const choice = { eachLine: true, captureToActiveFile: true, insertAfter: { enabled: false }, prepend: false, activeFileWritePosition: "cursor" } as never;

		const { captureContent } = await createFormatter().formatContentWithFile("- {{VALUE}}\n", choice, "", { path: "Board.canvas" } as never);

		expect(captureContent).toBe("- a\n- b\n");
	});

	it("gives each line its own {{RANDOM:...}}", async () => {
		promptMock.mockResolvedValueOnce("a\nb");

		const [first, second] = (await createFormatter().formatContentOnly("{{VALUE}} ^{{RANDOM:12}}", { eachLine: true })).split("\n");

		expect(first).toMatch(/^a \^\w{12}$/);
		expect(second).toMatch(/^b \^\w{12}$/);
		expect(first.slice(2)).not.toBe(second.slice(2));
	});

	it("splits a value passed in by a script, the URI, or the CLI, and leaves the variable as it was", async () => {
		const variables = new Map<string, unknown>([["value", "first\nsecond"]]);

		const result = await createFormatter(variables).formatContentOnly("{{VALUE}}", { eachLine: true });

		expect(result).toBe("first\nsecond");
		expect(variables.get("value")).toBe("first\nsecond");
		expect(promptMock).not.toHaveBeenCalled();
	});

	it("keeps a multi-line answer whole when the option is off", async () => {
		promptMock.mockResolvedValueOnce("one\ntwo");

		expect(await createFormatter().formatContentOnly("- {{VALUE}}\n")).toBe("- one\ntwo\n");
		expect(factoryMock).toHaveBeenCalledWith(undefined);
	});
});
