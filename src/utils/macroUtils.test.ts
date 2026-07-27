import { describe, expect, it } from "vitest";

import type { ICommand } from "../types/macros/ICommand";
import type { IMacro } from "../types/macros/IMacro";
import {
	commandListOf,
	hasCommandList,
	isCommandLike,
	isMacroObject,
	isUnreadableCommandList,
	isUnreadableMacro,
	normalizeCommandList,
	regenerateIds,
} from "./macroUtils";

const wait = (id: string, time = 100): ICommand =>
	({ id, name: "Wait", type: "Wait", time }) as unknown as ICommand;

/**
 * The `commands` values `data.json` actually shows up with, and whether each one
 * could still be CARRYING commands we cannot read. Shared by every case below so
 * a new shape is added in one place. Mirrors MALFORMED_CHILDREN_SHAPES.
 */
const MALFORMED_COMMAND_SHAPES: { key: string; value: unknown; carrying: boolean }[] = [
	{ key: "missing", value: undefined, carrying: false },
	{ key: "null", value: null, carrying: false },
	{ key: "emptyObject", value: {}, carrying: false },
	{ key: "emptyString", value: "", carrying: false },
	{ key: "zero", value: 0, carrying: false },
	{ key: "false", value: false, carrying: false },
	{ key: "arrayLikeObject", value: { "0": wait("hidden") }, carrying: true },
	{ key: "string", value: "not a list", carrying: true },
	{ key: "jsonString", value: '[{"id":"x","type":"Wait"}]', carrying: true },
	{ key: "number", value: 7, carrying: true },
];

describe("commandListOf", () => {
	it("hands back the live array when there is one", () => {
		const commands = [wait("a")];
		expect(commandListOf(commands)).toBe(commands);
	});

	it.each(MALFORMED_COMMAND_SHAPES)("reads $key as no commands", ({ value }) => {
		expect(commandListOf(value)).toEqual([]);
	});

	it("never hands back the same [] twice, so no caller can leak a shared array", () => {
		expect(commandListOf(null)).not.toBe(commandListOf(null));
	});
});

describe("hasCommandList", () => {
	it("is true only for a real array", () => {
		expect(hasCommandList([])).toBe(true);
		expect(hasCommandList([wait("a")])).toBe(true);
	});

	it.each(MALFORMED_COMMAND_SHAPES)("refuses to let a write rebuild $key", ({ value }) => {
		expect(hasCommandList(value)).toBe(false);
	});
});

describe("isUnreadableCommandList", () => {
	it("is false for a readable array", () => {
		expect(isUnreadableCommandList([])).toBe(false);
		expect(isUnreadableCommandList([wait("a")])).toBe(false);
	});

	it.each(MALFORMED_COMMAND_SHAPES)(
		"says whether $key could be carrying commands",
		({ value, carrying }) => {
			expect(isUnreadableCommandList(value)).toBe(carrying);
		},
	);
});

describe("isCommandLike", () => {
	it("accepts objects and rejects the holes a truncated write leaves", () => {
		expect(isCommandLike(wait("a"))).toBe(true);
		expect(isCommandLike(null)).toBe(false);
		expect(isCommandLike(undefined)).toBe(false);
		expect(isCommandLike("stray")).toBe(false);
		expect(isCommandLike(3)).toBe(false);
	});
});

describe("normalizeCommandList over a nested array entry", () => {
	// `isCommandLike([])` is true, so without an explicit branch an array entry
	// takes the re-key path and the normalizer MANUFACTURES `{"0":…,"1":…,id:…}` -
	// two real commands collapsed into one nameless row, persisted by the next
	// edit. Read as a nested list instead, byte-symmetric with
	// `normalizeChoiceList` (#1608).
	it("splices a nested list in, preserving order and ids", () => {
		const { commands, changed } = normalizeCommandList([
			wait("a"),
			[wait("b"), wait("c")],
			wait("d"),
		]);

		expect(changed).toBe(true);
		expect(commands.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
	});

	it("re-keys an id that collides ACROSS nesting levels", () => {
		const { commands } = normalizeCommandList([wait("dup"), [wait("dup")]]);

		expect(commands).toHaveLength(2);
		expect(commands[0].id).toBe("dup");
		expect(commands[1].id).not.toBe("dup");
		expect(commands[1].id).not.toBe("");
	});

	it("splices a junk array away to nothing", () => {
		const { commands } = normalizeCommandList([[1, 2, 3], wait("a")]);

		expect(commands.map((c) => c.id)).toEqual(["a"]);
	});
});

describe("normalizeCommandList", () => {
	it("is identity for a healthy list - same array, nothing changed", () => {
		const commands = [wait("a"), wait("b")];
		const result = normalizeCommandList(commands);
		expect(result.changed).toBe(false);
		expect(result.commands).toBe(commands);
	});

	it("keeps a duplicate-id command under a fresh id instead of dropping it", () => {
		const first = wait("dup", 100);
		const second = wait("dup", 200);
		const { commands, changed } = normalizeCommandList([first, second]);

		expect(changed).toBe(true);
		expect(commands).toHaveLength(2);
		// The first occurrence keeps its identity object and id.
		expect(commands[0]).toBe(first);
		// The second survives whole - only its id moved.
		expect(commands[1]).toMatchObject({ name: "Wait", type: "Wait", time: 200 });
		expect(commands[1].id).not.toBe("dup");
		expect(commands[1].id).not.toBe(commands[0].id);
	});

	it("mints an id for a command that has none, rather than hiding it", () => {
		const idless = { name: "Readwise sync", type: "UserScript", path: "s.js" };
		const { commands } = normalizeCommandList([idless]);

		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ name: "Readwise sync", path: "s.js" });
		expect(typeof commands[0].id).toBe("string");
		expect(commands[0].id).not.toBe("");
	});

	it.each([
		["empty string", ""],
		["number", 3],
		["null", null],
	])("mints an id for a command whose id is a %s", (_label, id) => {
		const { commands } = normalizeCommandList([{ name: "X", type: "Wait", id }]);
		expect(commands).toHaveLength(1);
		expect(typeof commands[0].id).toBe("string");
		expect(commands[0].id).not.toBe("");
	});

	it("gives two id-less commands DIFFERENT ids (the each_key_duplicate case)", () => {
		const { commands } = normalizeCommandList([
			{ name: "A", type: "Wait" },
			{ name: "B", type: "Wait" },
		]);
		expect(commands[0].id).not.toBe(commands[1].id);
	});

	it("drops holes, which carry nothing, and keeps everything around them", () => {
		const a = wait("a");
		const b = wait("b");
		const { commands, changed } = normalizeCommandList([a, null, "stray", b, 7]);

		expect(changed).toBe(true);
		expect(commands).toEqual([a, b]);
	});

	it("never mutates its input", () => {
		const input = [wait("dup"), wait("dup"), null];
		const before = JSON.stringify(input);
		normalizeCommandList(input);
		expect(JSON.stringify(input)).toBe(before);
	});

	it.each(MALFORMED_COMMAND_SHAPES)("reads $key as an empty list", ({ value }) => {
		expect(normalizeCommandList(value).commands).toEqual([]);
	});

	it("is idempotent", () => {
		const first = normalizeCommandList([wait("dup"), wait("dup"), null]);
		const second = normalizeCommandList(first.commands);
		expect(second.changed).toBe(false);
		expect(second.commands).toBe(first.commands);
	});
});

describe("regenerateIds", () => {
	it("re-ids the macro and every command", () => {
		const macro: IMacro = {
			id: "m",
			name: "M",
			commands: [wait("a"), wait("b")],
		};
		regenerateIds(macro);

		expect(macro.id).not.toBe("m");
		expect(macro.commands[0].id).not.toBe("a");
		expect(macro.commands[1].id).not.toBe("b");
	});

	it.each(MALFORMED_COMMAND_SHAPES)(
		"leaves a $key commands value exactly as it found it",
		({ key, value }) => {
			const macro = { id: "m", name: "M" } as Record<string, unknown>;
			if (value !== undefined) macro.commands = value;
			const before = JSON.stringify(macro.commands ?? null);

			expect(() => regenerateIds(macro as unknown as IMacro)).not.toThrow();

			expect(JSON.stringify(macro.commands ?? null)).toBe(before);
			expect("commands" in macro).toBe(key !== "missing");
			// The macro id is still refreshed: only the unreadable value is preserved.
			expect(macro.id).not.toBe("m");
		},
	);

	it("steps over a hole in the list instead of dereferencing it", () => {
		const macro = {
			id: "m",
			name: "M",
			commands: [wait("a"), null, wait("b")],
		} as unknown as IMacro;

		expect(() => regenerateIds(macro)).not.toThrow();
		expect(macro.commands[0].id).not.toBe("a");
		expect(macro.commands[1]).toBeNull();
		expect(macro.commands[2].id).not.toBe("b");
	});

	it("tolerates a macro that is not an object at all", () => {
		expect(() => regenerateIds(null as unknown as IMacro)).not.toThrow();
		expect(() => regenerateIds("x" as unknown as IMacro)).not.toThrow();
	});
});

describe("isMacroObject / isUnreadableMacro", () => {
	// An ARRAY is `typeof === "object"`, so the looser isCommandLike accepts one.
	// That mattered: writing `macro.commands = [...]` onto an Array sets a
	// non-index property, which JSON.stringify (i.e. saveData) silently drops -
	// so the editor showed the user's new commands and every save discarded them.
	it("rejects arrays, which cannot carry a macro's fields through JSON", () => {
		expect(isMacroObject({})).toBe(true);
		expect(isMacroObject({ id: "m", name: "M", commands: [] })).toBe(true);
		expect(isMacroObject([])).toBe(false);
		expect(isMacroObject([wait("a")])).toBe(false);
		expect(isMacroObject(null)).toBe(false);
		expect(isMacroObject("x")).toBe(false);
	});

	it("proves the JSON hazard the predicate exists for", () => {
		const asArray: unknown = [];
		(asArray as Record<string, unknown>).commands = [wait("new")];
		expect(JSON.parse(JSON.stringify(asArray))).toEqual([]);
	});

	it.each([
		["a macro object", {}, false],
		["a populated macro object", { id: "m", commands: [] }, false],
		["undefined", undefined, false],
		["null", null, false],
		["an empty array", [], false],
		["an empty string", "", false],
		["a populated array", [wait("a")], true],
		["a string", "not a macro", true],
		["a number", 7, true],
	])("says whether %s could be carrying a macro", (_label, value, expected) => {
		expect(isUnreadableMacro(value)).toBe(expected);
	});
});
