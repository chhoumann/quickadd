import { describe, expect, it, vi } from "vitest";
import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";
import { settingsTreeHasUnreadableData } from "./helpers/choice-traversal";
import removeMacroIndirection from "./removeMacroIndirection";
import backfillFileOpeningDefaults from "./backfillFileOpeningDefaults";
import migrateFileOpeningSettings from "./migrateFileOpeningSettings";
import consolidateFileExistsBehavior from "./consolidateFileExistsBehavior";
import incrementFileNameSettingMoveToDefaultBehavior from "./incrementFileNameSettingMoveToDefaultBehavior";
import mutualExclusionInsertAfterAndWriteToBottomOfFile from "./mutualExclusionInsertAfterAndWriteToBottomOfFile";

/**
 * #1610. A migration is run once and then flagged complete FOREVER, so one that
 * silently walked past a subtree it could not read leaves that subtree
 * un-migrated permanently - repairing data.json by hand afterwards does not help,
 * because the flag is already set.
 *
 * The guard therefore has to answer for exactly what the migration's own
 * traversal covers. Too narrow and data is lost silently; too wide and the
 * migration blocks itself on data it was never going to touch, which for
 * `removeMacroIndirection` means every legacy macro choice in the vault stays
 * dead.
 */

// Factories, not shared constants: these migrations MUTATE what they walk, so a
// shared object would carry one test's migration into the next one's assertions.
const hiddenCapture = () =>
	({
		id: "hidden",
		name: "Hidden capture",
		type: "Capture",
		command: false,
		openFileInNewTab: { enabled: true, direction: "horizontal", focus: false },
	}) as unknown as IChoice;

const nested = () => ({
	id: "n",
	name: "N",
	type: "NestedChoice",
	choice: hiddenCapture(),
});

const macroChoiceWith = (commands: unknown, macro?: unknown): IChoice =>
	({
		id: "macro-1",
		name: "Macro",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: macro !== undefined ? macro : { id: "m", name: "Macro", commands },
	}) as unknown as IChoice;

const makePlugin = (settings: Record<string, unknown>) =>
	({
		settings,
		saveSettings: vi.fn(),
	}) as unknown as QuickAdd;

describe("settingsTreeHasUnreadableData", () => {
	it("sees a nested choice hidden behind an unreadable macro.commands", () => {
		// The #1610 headline: `treeHasUnreadableChildren` asked about Multi.choices
		// only, so this tree reported READABLE and the migrations that walk it
		// reported complete over a choice they never visited.
		expect(
			settingsTreeHasUnreadableData({
				choices: [macroChoiceWith({ "0": nested() })] as IChoice[],
			}),
		).toBe(true);
	});

	it("actually VISITS an array-valued macro rather than calling it unreadable", async () => {
		// `[].commands` is `undefined`, which walks nothing and reports readable - a
		// silent hole in both the walk and the guard derived from it. The array IS
		// the command list (writing `.commands` onto an Array is dropped by
		// JSON.stringify), so this tree is genuinely readable AND the nested choice
		// inside it has to be migrated, not merely declared visible.
		const plugin = makePlugin({
			choices: [macroChoiceWith(undefined, [nested()])],
			migrations: {},
		});

		const result = await backfillFileOpeningDefaults.migrate(plugin);

		expect(result).toBeUndefined();
		const choices = (plugin.settings as unknown as Record<string, unknown>)
			.choices as Record<string, Record<string, unknown>>[];
		const visited = (choices[0].macro as unknown as Record<string, unknown>[])[0];
		expect((visited.choice as Record<string, unknown>).fileOpening).toEqual({
			location: "split",
			direction: "horizontal",
			mode: "default",
			focus: false,
		});
	});

	it("sees an unreadable conditional branch", () => {
		expect(
			settingsTreeHasUnreadableData({
				choices: [
					macroChoiceWith([
						{
							id: "c",
							name: "If",
							type: "Conditional",
							thenCommands: { "0": nested() },
							elseCommands: [],
						},
					]),
				] as IChoice[],
			}),
		).toBe(true);
	});

	it("sees an unreadable legacy settings.macros", () => {
		expect(
			settingsTreeHasUnreadableData({
				choices: [] as IChoice[],
				macros: { "0": { id: "m", name: "M", commands: [nested()] } },
			}),
		).toBe(true);
		// ...but a missing one is the NORMAL post-consolidation state.
		expect(settingsTreeHasUnreadableData({ choices: [] as IChoice[] })).toBe(false);
		expect(
			settingsTreeHasUnreadableData({ choices: [] as IChoice[], macros: [] }),
		).toBe(false);
	});

	it("is strict about the root and lenient about every container below it", () => {
		for (const root of [undefined, null, {}, "", 0, false]) {
			expect(
				settingsTreeHasUnreadableData({ choices: root as unknown as IChoice[] }),
				`root ${JSON.stringify(root) ?? "undefined"}`,
			).toBe(true);
		}
		for (const empty of [undefined, null, {}, "", 0, false]) {
			expect(
				settingsTreeHasUnreadableData({
					choices: [macroChoiceWith(empty)] as IChoice[],
				}),
				`commands ${JSON.stringify(empty) ?? "undefined"}`,
			).toBe(false);
		}
	});
});

describe("the guarded migrations over an unreadable macro.commands", () => {
	const treeWithHiddenChoice = () => [
		{
			id: "t",
			name: "T",
			type: "Template",
			command: false,
			openFileInNewTab: { enabled: true, direction: "horizontal", focus: false },
		},
		macroChoiceWith({ "0": nested() }),
	];

	it.each([
		["backfillFileOpeningDefaults", backfillFileOpeningDefaults],
		["migrateFileOpeningSettings", migrateFileOpeningSettings],
		["consolidateFileExistsBehavior", consolidateFileExistsBehavior],
	])("%s stays pending instead of being flagged complete", async (_name, migration) => {
		const plugin = makePlugin({
			choices: treeWithHiddenChoice(),
			migrations: {},
		});

		const result = await migration.migrate(plugin);

		expect(result).toEqual({ complete: false });
		// The readable half still ran - staying pending must not mean doing nothing,
		// or a user who never repairs data.json gets no migration at all.
		const settings = plugin.settings as unknown as { choices: Record<string, unknown>[] };
		expect(settings.choices[0].fileOpening ?? settings.choices[0].type).toBeTruthy();
	});

	it("does not write data.json itself while pending", async () => {
		const plugin = makePlugin({ choices: treeWithHiddenChoice(), migrations: {} });
		await backfillFileOpeningDefaults.migrate(plugin);
		await migrateFileOpeningSettings.migrate(plugin);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("does NOT block removeMacroIndirection, which never descends commands", async () => {
		// It walks with flattenChoices. Blocking it here would be pure cost, and
		// expensive cost: nothing at runtime resolves `macroId`, so every legacy
		// macro choice stays dead until this migration completes.
		const plugin = makePlugin({
			choices: [
				macroChoiceWith({ "0": nested() }),
				{ id: "legacy", name: "Legacy", type: "Macro", macroId: "old-macro" },
			],
			macros: [{ id: "old-macro", name: "Old", commands: [] }],
			migrations: {},
		});

		const result = await removeMacroIndirection.migrate(plugin);

		expect(result).toBeUndefined();
		const settings = plugin.settings as unknown as Record<string, unknown>;
		expect(settings.macros).toBeUndefined();
		const legacy = (settings.choices as Record<string, unknown>[])[1];
		expect(legacy.macroId).toBeUndefined();
		expect(legacy.macro).toEqual({ id: "old-macro", name: "Old", commands: [] });
	});
});

describe("an untrusted settings.macros", () => {
	// Each of these used to throw `macros is not iterable`, which migrate.ts
	// catches, reverts and reports with a 15-second "please create an issue"
	// notice - on every single launch, because the flag stays unset.
	const arrayLikeMacros = { "0": { id: "m", name: "M", commands: [] } };

	it.each([
		["removeMacroIndirection", removeMacroIndirection],
		[
			"incrementFileNameSettingMoveToDefaultBehavior",
			incrementFileNameSettingMoveToDefaultBehavior,
		],
		[
			"mutualExclusionInsertAfterAndWriteToBottomOfFile",
			mutualExclusionInsertAfterAndWriteToBottomOfFile,
		],
	])("%s stays pending and leaves the value verbatim", async (_name, migration) => {
		const plugin = makePlugin({
			choices: [],
			macros: arrayLikeMacros,
			migrations: {},
		});

		const result = await migration.migrate(plugin);

		expect(result).toEqual({ complete: false });
		// Never rewritten to the [] the READ accessor hands back: the user has to be
		// able to recover this by hand.
		expect((plugin.settings as unknown as Record<string, unknown>).macros).toEqual(
			arrayLikeMacros,
		);
	});

	it("steps over a hole in the legacy macro list", async () => {
		const plugin = makePlugin({
			choices: [],
			macros: [null, { id: "m", name: "M", commands: [] }],
			migrations: {},
		});

		await expect(removeMacroIndirection.migrate(plugin)).resolves.toBeUndefined();
	});
});

describe("a corrupt root choices value", () => {
	it("never reaches removeMacroIndirection's push", async () => {
		for (const root of [null, {}, "not a list", 7]) {
			const plugin = makePlugin({
				choices: root,
				macros: [{ id: "orphan", name: "Orphan", commands: [] }],
				migrations: {},
			});

			// The point of the separate Array.isArray guard: a readability predicate
			// must never be the only thing standing between a corrupt value and a
			// TypeError out of `settings.choices.push`.
			await expect(
				removeMacroIndirection.migrate(plugin),
			).resolves.toEqual({ complete: false });
			const settings = plugin.settings as unknown as Record<string, unknown>;
			expect(settings.choices).toEqual(root);
			// ...and the orphan source is still there to be rehomed on a later launch.
			expect(settings.macros).toEqual([
				{ id: "orphan", name: "Orphan", commands: [] },
			]);
		}
	});
});
