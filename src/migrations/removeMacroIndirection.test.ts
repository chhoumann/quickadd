import { describe, expect, it } from "vitest";
import type QuickAdd from "src/main";
import removeMacroIndirection from "./removeMacroIndirection";

/**
 * #1566. This migration MOVES legacy macros into the choice tree and then
 * deletes the old `macros` array, so it is the one migration where "walk past
 * what you cannot read and carry on" is the wrong answer: with an unreadable
 * root there is nowhere to move them to, and finishing would delete them
 * outright. Migrations are flagged once and never retried, so that loss would
 * be permanent even after the user repaired data.json by hand.
 */

const legacyMacro = () => ({
	id: "macro-1",
	name: "Legacy macro",
	commands: [{ id: "c1", name: "Wait", type: "Wait", time: 100 }],
	runOnStartup: true,
});

describe("removeMacroIndirection with an unreadable root (#1566)", () => {
	it("keeps the legacy macros and stays pending", async () => {
		const macros = [legacyMacro()];
		const plugin = {
			settings: { choices: { invalid: true }, macros },
		} as unknown as QuickAdd;

		const result = await removeMacroIndirection.migrate(plugin);

		// Pending, so it runs again once the root is repaired...
		expect(result).toEqual({ complete: false });
		// ...and nothing was destroyed in the meantime.
		expect((plugin.settings as { macros?: unknown }).macros).toBe(macros);
		expect(plugin.settings.choices).toEqual({ invalid: true });
	});

	it("stays pending for an unreadable folder NESTED in a readable root", async () => {
		// The root array is fine, so a root-only guard lets the migration finish.
		// flattenChoices then cannot see the folder's descendants, so a macro one
		// of them references looks orphaned: it is duplicated at the root, the
		// shared `macros` array is deleted, and the hidden choice keeps a dangling
		// macroId forever - a completed migration never retries.
		const macros = [legacyMacro()];
		const plugin = {
			settings: {
				choices: [
					{
						id: "folder",
						name: "Folder",
						type: "Multi",
						command: false,
						collapsed: false,
						choices: { "0": { id: "hidden", type: "Macro", macroId: "macro-1" } },
					},
				],
				macros,
			},
		} as unknown as QuickAdd;

		const result = await removeMacroIndirection.migrate(plugin);

		expect(result).toEqual({ complete: false });
		expect((plugin.settings as { macros?: unknown }).macros).toBe(macros);
		expect(plugin.settings.choices).toHaveLength(1);
	});

	it("still migrates and cleans up when the root is readable", async () => {
		const plugin = {
			settings: { choices: [], macros: [legacyMacro()] },
		} as unknown as QuickAdd;

		const result = await removeMacroIndirection.migrate(plugin);

		expect(result).toBeUndefined();
		expect((plugin.settings as { macros?: unknown }).macros).toBeUndefined();
		expect(plugin.settings.choices).toHaveLength(1);
		expect(plugin.settings.choices[0].name).toBe("Legacy macro");
	});
});

describe("removeMacroIndirection embedding", () => {
	const migrate = async (settings: Record<string, unknown>) => {
		const plugin = { settings } as unknown as QuickAdd;
		await removeMacroIndirection.migrate(plugin);
		return plugin.settings as unknown as {
			choices: Array<Record<string, any>>;
			macros?: unknown;
		};
	};

	it("embeds a shared macro into every choice that references it", async () => {
		const settings = await migrate({
			choices: ["First", "Second", "Third"].map((name, i) => ({
				id: `choice${i}`,
				type: "Macro",
				name,
				macroId: "shared-macro",
			})),
			macros: [
				{
					id: "shared-macro",
					name: "Shared Macro",
					commands: [{ type: "UserScript", path: "test.js" }],
					runOnStartup: true,
				},
			],
		});

		expect(settings.choices).toHaveLength(3);
		for (const choice of settings.choices) {
			expect(choice).not.toHaveProperty("macroId");
			expect(choice.runOnStartup).toBe(true);
			expect(choice.macro).toMatchObject({
				id: "shared-macro",
				name: "Shared Macro",
				commands: [{ type: "UserScript", path: "test.js" }],
			});
		}
		expect(settings.macros).toBeUndefined();
	});

	it("turns a macro no choice references into a new macro choice", async () => {
		const settings = await migrate({
			choices: [{ id: "choice1", type: "Template", name: "Some Template" }],
			macros: [
				{
					id: "orphaned-macro",
					name: "Orphaned Macro",
					commands: [{ type: "UserScript", path: "orphaned.js" }],
					runOnStartup: false,
				},
			],
		});

		expect(settings.choices).toHaveLength(2);
		const created = settings.choices.find((c) => c.type === "Macro");
		expect(created).toMatchObject({
			name: "Orphaned Macro",
			runOnStartup: false,
			macro: { id: "orphaned-macro", commands: [{ type: "UserScript", path: "orphaned.js" }] },
		});
		expect(created).not.toHaveProperty("macroId");
		expect(settings.macros).toBeUndefined();
	});

	it("drops a macroId that points at no macro", async () => {
		const settings = await migrate({
			choices: [{ id: "choice1", type: "Macro", name: "Orphaned Reference", macroId: "missing-macro" }],
			macros: [],
		});

		expect(settings.choices[0]).not.toHaveProperty("macroId");
		expect(settings.choices[0].macro).toBeUndefined();
		expect(settings.macros).toBeUndefined();
	});

	it("leaves an already-embedded macro alone, keeping the choice's own runOnStartup", async () => {
		const embedded = {
			id: "choice1",
			type: "Macro",
			name: "Already Embedded",
			macro: { id: "embedded-macro", name: "Embedded Macro", commands: [{ type: "UserScript", path: "embedded.js" }] },
			runOnStartup: false,
		};
		const settings = await migrate({
			choices: [structuredClone(embedded)],
			// The legacy definition disagrees on runOnStartup; the user's choice wins.
			macros: [{ ...embedded.macro, runOnStartup: true }],
		});

		expect(settings.choices).toEqual([embedded]);
		expect(settings.macros).toBeUndefined();
	});
});
