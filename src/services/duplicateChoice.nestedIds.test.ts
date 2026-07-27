import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { duplicateChoice } from "./choiceService";
import type IChoice from "../types/choices/IChoice";
import {
	buildUserScriptSecretId,
	createUserScriptSecretRef,
} from "../utils/userScriptSecrets";
import type { IUserScript } from "../types/macros/IUserScript";

/**
 * #1609. `regenerateIds` re-ided the macro and its TOP-LEVEL commands only, so a
 * duplicated macro shared every id below that with its original. Nothing crashed
 * - it is not a within-list collision - but a stored user-script secret is keyed
 * on `command.id` (`buildUserScriptSecretId`), so the copy re-adopted the
 * original's secret slot: change the API key on the copy and you changed it on
 * the original.
 */

const collectIds = (value: unknown, out: unknown[] = []): unknown[] => {
	if (Array.isArray(value)) {
		for (const entry of value) collectIds(entry, out);
		return out;
	}
	if (typeof value !== "object" || value === null) return out;
	for (const [key, nested] of Object.entries(value)) {
		if (key === "id") out.push(nested);
		else collectIds(nested, out);
	}
	return out;
};

const collectSecretRefs = (value: unknown, out: string[] = []): string[] => {
	if (typeof value !== "object" || value === null) return out;
	if (Array.isArray(value)) {
		for (const entry of value) collectSecretRefs(entry, out);
		return out;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.secretRef === "string") out.push(record.secretRef);
	for (const nested of Object.values(record)) collectSecretRefs(nested, out);
	return out;
};

const userScript = (id: string) => ({
	id,
	name: "secrets.js",
	type: "UserScript",
	path: "scripts/secrets.js",
	settings: { "API key": createUserScriptSecretRef("secrets-api-key") },
});

const macroChoice = (macro: unknown): IChoice =>
	({
		id: "macro-choice",
		name: "Macro",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro,
	}) as unknown as IChoice;

const deepMacroCommands = () => [
	userScript("top-script"),
	{
		id: "cond",
		name: "If",
		type: "Conditional",
		condition: { mode: "variable", variableName: "x", operator: "isTruthy" },
		thenCommands: [userScript("then-script")],
		elseCommands: [
			{
				id: "nested-cmd",
				name: "Inner",
				type: "NestedChoice",
				choice: {
					id: "inner-macro-choice",
					name: "Inner macro",
					type: "Macro",
					macro: {
						id: "inner-macro",
						name: "Inner macro",
						commands: [userScript("inner-script")],
					},
				},
			},
		],
	},
	{
		id: "nested-folder-cmd",
		name: "Folder",
		type: "NestedChoice",
		choice: {
			id: "inner-folder",
			name: "Inner folder",
			type: "Multi",
			choices: [{ id: "inner-leaf", name: "Leaf", type: "Capture" }],
		},
	},
];

describe("duplicating a macro", () => {
	it("shares no id with the original, at any depth", () => {
		const source = macroChoice({
			id: "m",
			name: "Macro",
			commands: deepMacroCommands(),
		});

		const copy = duplicateChoice(source);

		const originalIds = collectIds(source);
		const copyIds = collectIds(copy);
		expect(copyIds).toHaveLength(originalIds.length);
		expect(
			copyIds.filter((id) => originalIds.includes(id)),
			"ids shared with the original",
		).toEqual([]);
		// Every id inside the copy is distinct from every other.
		expect(new Set(copyIds).size).toBe(copyIds.length);
	});

	it("carries no secret reference belonging to the original", () => {
		// Pins the STRIP half: it already recursed branch commands and a nested
		// choice's own macro before this change, and must keep doing so.
		const source = macroChoice({
			id: "m",
			name: "Macro",
			commands: deepMacroCommands(),
		});

		const copy = duplicateChoice(source);

		expect(collectSecretRefs(source)).toContain("secrets-api-key");
		expect(collectSecretRefs(copy)).toEqual([]);
	});

	it("gives a nested user script a DIFFERENT stored-secret slot", () => {
		// The reported symptom, asserted directly. Stripping the ref is not enough:
		// `migrateUserScriptSecretSettings` re-adopts an existing secret by
		// `buildUserScriptSecretId`, which keys on `command.id` - so while the copy's
		// nested command kept the original's id, the copy silently adopted the
		// original's slot and the next edit overwrote the original's key.
		const source = macroChoice({
			id: "m",
			name: "Macro",
			commands: deepMacroCommands(),
		});

		const copy = duplicateChoice(source);

		const nestedScript = (choice: IChoice): IUserScript => {
			const commands = (choice as unknown as Record<string, Record<string, unknown[]>>)
				.macro.commands as Record<string, unknown>[];
			const conditional = commands[1] as unknown as Record<string, IUserScript[]>;
			return conditional.thenCommands[0];
		};

		expect(
			buildUserScriptSecretId(nestedScript(copy), "API key"),
		).not.toBe(buildUserScriptSecretId(nestedScript(source), "API key"));
	});

	it("does the same for an ARRAY-valued macro, where the array IS the commands", () => {
		// `isRecord([])` is true, so the sanitizer read `.commands` off an array,
		// got `undefined`, and stripped nothing - the copy kept the original's
		// literal secretRef, and editing its key wrote over the original's slot.
		const source = macroChoice(deepMacroCommands());

		const copy = duplicateChoice(source);

		expect(collectSecretRefs(copy)).toEqual([]);
		const originalIds = collectIds(source);
		expect(
			collectIds(copy).filter((id) => originalIds.includes(id)),
		).toEqual([]);
	});

	it("recurses a NESTED command array, which is a list and not a command", () => {
		// `normalizeCommandList` splices a nested array into the list at the editor
		// seam, so its entries are real commands. Treating the array itself as one
		// writes an `id` that JSON.stringify drops and leaves every id inside it -
		// and every secretRef - shared with the original.
		const source = macroChoice({
			id: "m",
			name: "M",
			commands: [[userScript("nested-in-array")]],
		});

		const copy = duplicateChoice(source) as unknown as Record<
			string,
			Record<string, unknown[][]>
		>;

		const inner = copy.macro.commands[0][0] as Record<string, unknown>;
		expect(inner.id).not.toBe("nested-in-array");
		expect(collectSecretRefs(copy)).toEqual([]);
	});

	it("leaves a malformed command list exactly as found", () => {
		// A WRITE path: `{"0": {...}}` must survive on disk to be recovered by hand,
		// so the copy is as faithful as the original rather than "repaired" to [].
		for (const commands of [{ "0": userScript("hidden") }, "not a list", 7, null]) {
			const source = macroChoice({ id: "m", name: "M", commands });

			const copy = duplicateChoice(source) as unknown as Record<
				string,
				Record<string, unknown>
			>;

			expect(copy.macro.commands, JSON.stringify(commands)).toEqual(commands);
			expect(copy.macro.id).not.toBe("m");
		}
	});

	it("steps over a hole rather than dereferencing it", () => {
		const source = macroChoice({
			id: "m",
			name: "M",
			commands: [null, "stray", userScript("real")],
		});

		const copy = duplicateChoice(source) as unknown as Record<
			string,
			Record<string, unknown>
		>;

		const commands = copy.macro.commands as unknown[];
		expect(commands).toHaveLength(3);
		expect(commands[0]).toBeNull();
		expect(commands[1]).toBe("stray");
		expect((commands[2] as Record<string, unknown>).id).not.toBe("real");
	});

	it("gives a SHARED node one new id rather than two", () => {
		// `deepClone` is `structuredClone`, which preserves shared references. Two
		// pointers to one object are one command, so it must be re-ided once - not
		// visited twice and left with the second mint under the first pointer.
		const shared = { id: "shared", name: "Wait", type: "Wait", time: 1 };
		const source = macroChoice({
			id: "m",
			name: "M",
			commands: [
				{
					id: "cond",
					name: "If",
					type: "Conditional",
					thenCommands: [shared],
					elseCommands: [shared],
				},
			],
		});

		const copy = duplicateChoice(source) as unknown as Record<
			string,
			Record<string, Record<string, unknown>[]>
		>;

		const cond = copy.macro.commands[0] as unknown as Record<
			string,
			Record<string, unknown>[]
		>;
		expect(cond.thenCommands[0]).toBe(cond.elseCommands[0]);
		expect(cond.thenCommands[0].id).not.toBe("shared");
	});
});
