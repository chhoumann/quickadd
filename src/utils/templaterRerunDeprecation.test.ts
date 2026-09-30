import { describe, expect, it, vi } from "vitest";
import { CommandType } from "../types/macros/CommandType";
import type IChoice from "../types/choices/IChoice";
import type { ICommand } from "../types/macros/ICommand";

const logWarning = vi.fn();
vi.mock("../logger/logManager", () => ({ log: { logWarning } }));

const { templaterRerunAfter, warnDeprecatedOnce, TEMPLATER_REPLACE_COMMAND_ID } = await import("./templaterRerunDeprecation");

const choices: Record<string, IChoice> = {
	cap: { id: "cap", name: "Log", type: "Capture", command: false },
	mac: { id: "mac", name: "Other macro", type: "Macro", command: false },
};
const resolve = (id: string) => choices[id] ?? null;
const replace = { id: "r", name: "Templater: Replace templates in the active file", type: CommandType.Obsidian, commandId: TEMPLATER_REPLACE_COMMAND_ID } as ICommand;
const nested = (type: IChoice["type"]) => ({ id: "n", name: "step", type: CommandType.NestedChoice, choice: { id: "x", name: `New ${type}`, type, command: false } }) as ICommand;
const choiceStep = (choiceId: string) => ({ id: "c", name: "step", type: CommandType.Choice, choiceId }) as ICommand;

describe("templaterRerunAfter (#2014)", () => {
	it("names the Template or Capture step that Replace templates runs after", () => {
		expect(templaterRerunAfter(nested("Template"), replace, resolve)).toBe("New Template");
		expect(templaterRerunAfter(choiceStep("cap"), replace, resolve)).toBe("Log");
	});

	it("ignores Replace templates after any other step, and other commands after a choice", () => {
		expect(templaterRerunAfter(undefined, replace, resolve)).toBeNull();
		expect(templaterRerunAfter(choiceStep("mac"), replace, resolve)).toBeNull();
		expect(templaterRerunAfter(choiceStep("missing"), replace, resolve)).toBeNull();
		const other = { ...replace, commandId: "editor:toggle-bold" } as ICommand;
		expect(templaterRerunAfter(nested("Capture"), other, resolve)).toBeNull();
	});
});

describe("warnDeprecatedOnce", () => {
	it("warns once per key for the session", () => {
		warnDeprecatedOnce("a", "first");
		warnDeprecatedOnce("a", "again");
		warnDeprecatedOnce("b", "other");
		expect(logWarning.mock.calls).toEqual([["first"], ["other"]]);
	});
});
