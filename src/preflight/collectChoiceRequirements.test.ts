import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { IUserScript } from "src/types/macros/IUserScript";
import { collectChoiceRequirements } from "./collectChoiceRequirements";

const { getUserScriptMock } = vi.hoisted(() => ({
	getUserScriptMock: vi.fn(),
}));

vi.mock("src/utilityObsidian", () => ({
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesWithTag: vi.fn(() => []),
	getUserScript: getUserScriptMock,
	isFolder: vi.fn(() => false),
}));

function createMacroChoice(script: IUserScript): IMacroChoice {
	return {
		id: "macro-choice",
		name: "Macro Choice",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "macro-choice",
			name: "Macro Choice",
			commands: [script],
		},
	};
}

describe("collectChoiceRequirements - macro script metadata", () => {
	const app = {} as App;
	const plugin = {} as any;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};

	const scriptCommand: IUserScript = {
		id: "script-1",
		name: "Script 1",
		type: CommandType.UserScript,
		path: "script.js",
		settings: {},
	};

	beforeEach(() => {
		getUserScriptMock.mockReset();
	});

	it("reads quickadd.inputs from function exports", async () => {
		const exported = (() => {}) as ((...args: unknown[]) => unknown) & {
			quickadd?: unknown;
		};
		exported.quickadd = {
			inputs: [{ id: "project", type: "text", label: "Project" }],
		};
		getUserScriptMock.mockResolvedValue(exported);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "project",
					type: "text",
					label: "Project",
					source: "script",
				}),
			]),
		);
	});

	it("ignores malformed input entries", async () => {
		const exported = (() => {}) as ((...args: unknown[]) => unknown) & {
			quickadd?: unknown;
		};
		exported.quickadd = {
			inputs: [{ id: "missingType" }, { type: "text" }, null],
		};
		getUserScriptMock.mockResolvedValue(exported);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual([]);
	});
});
