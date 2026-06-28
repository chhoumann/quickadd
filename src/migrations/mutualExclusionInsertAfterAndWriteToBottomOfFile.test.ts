import { describe, expect, it } from "vitest";
import { CommandType } from "../types/macros/CommandType";
import migration from "./mutualExclusionInsertAfterAndWriteToBottomOfFile";

describe("mutualExclusionInsertAfterAndWriteToBottomOfFile migration", () => {
	it("does not throw on a legacy capture choice that lacks insertAfter", async () => {
		// A capture choice persisted by an old version / imported / hand-edited in
		// data.json may have no `insertAfter` object at all. Migrations run on RAW
		// settings before CaptureChoice.Load normalizes them, so reading
		// `insertAfter.enabled` unguarded throws TypeError, the migration runner
		// reverts to backup WITHOUT marking the migration done, and it re-fails on
		// every startup.
		const plugin = {
			settings: {
				choices: [
					{
						id: "legacy-capture",
						name: "Legacy Capture",
						type: "Capture",
						prepend: true,
						// no `insertAfter`
					},
				],
				macros: [],
			},
		} as any;

		await expect(migration.migrate(plugin)).resolves.toBeUndefined();
		// insertAfter absent -> treated as not-enabled -> prepend is left untouched.
		expect(plugin.settings.choices[0].prepend).toBe(true);
	});

	it("does not throw on a nested macro capture choice that lacks insertAfter", async () => {
		const plugin = {
			settings: {
				choices: [],
				macros: [
					{
						id: "macro-1",
						name: "Macro",
						commands: [
							{
								type: CommandType.NestedChoice,
								choice: {
									id: "nested-capture",
									name: "Nested Capture",
									type: "Capture",
									prepend: true,
									// no `insertAfter`
								},
							},
						],
					},
				],
			},
		} as any;

		await expect(migration.migrate(plugin)).resolves.toBeUndefined();
		expect(
			plugin.settings.macros[0].commands[0].choice.prepend,
		).toBe(true);
	});

	it("still disables prepend when insertAfter is enabled (top-level and nested)", async () => {
		const plugin = {
			settings: {
				choices: [
					{
						id: "top-capture",
						name: "Top Capture",
						type: "Capture",
						prepend: true,
						insertAfter: { enabled: true },
					},
				],
				macros: [
					{
						id: "macro-1",
						name: "Macro",
						commands: [
							{
								type: CommandType.NestedChoice,
								choice: {
									id: "nested-capture",
									name: "Nested Capture",
									type: "Capture",
									prepend: true,
									insertAfter: { enabled: true },
								},
							},
						],
					},
				],
			},
		} as any;

		await migration.migrate(plugin);

		expect(plugin.settings.choices[0].prepend).toBe(false);
		expect(
			plugin.settings.macros[0].commands[0].choice.prepend,
		).toBe(false);
	});
});
