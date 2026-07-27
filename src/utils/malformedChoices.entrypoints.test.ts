import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import type IChoice from "src/types/choices/IChoice";
import {
	childChoicesOf,
	dedupeChoicesById,
	flattenChoices,
	flattenChoicesWithPath,
	hasChildChoices,
	hasUnreadableChildren,
	isChoiceLike,
	resolveChoiceIcon,
	rootChoicesOf,
} from "./choiceUtils";
import { collectChoiceClosure } from "./packageTraversal";
import {
	addChoiceToTree,
	duplicateChoice,
	findChoiceById,
	insertChoiceAfter,
	insertIntoMulti,
	moveChoice,
	moveChoiceToRoot,
	removeChoiceById,
	setFolderChildrenById,
	setMultiCollapsedById,
	updateMultiById,
} from "../services/choiceService";
import {
	isChoiceNested,
	computeEligibleMultiTargets,
} from "../gui/choiceList/contextMenu";
import { uniqueDefaultChoiceName } from "../gui/choiceList/choiceTypeMeta";
import {
	emptyFolderNoticeText,
	folderFlairFor,
	isEmptyFolderChoice,
} from "../gui/suggesters/choiceSuggester";
import { getChoicesAsList as macroBuilderChoiceList } from "../gui/MacroGUIs/MacroBuilder";
import {
	commandListOf,
	hasCommandList,
	isUnreadableCommandList,
	normalizeCommandList,
	regenerateIds,
} from "./macroUtils";
import type { IMacro } from "../types/macros/IMacro";
import { buildPackagePreview } from "../services/packagePreview";
import {
	QUICKADD_PACKAGE_SCHEMA_VERSION,
	type QuickAddPackage,
} from "../types/packages/QuickAddPackage";
import {
	HEALTHY_IDS,
	leaf,
	malformedSnapshot,
	malformedTree,
} from "./malformedChoices.fixture";

/**
 * The ratchet for #1566.
 *
 * The bug was never one unguarded dereference; it was that `data.json` is
 * untrusted and roughly forty readers each decided for themselves whether to
 * guard, using guards (`?? []`, `if (choice.choices)`) that look right and are
 * not. Fixing the readers we know about does nothing to stop the next one.
 *
 * So: one fixture tree carrying every malformed shape, pushed through every
 * exported entry point that walks a choice tree. Each case asserts two things -
 * that nothing throws, AND that the malformed values are identical afterwards.
 * The second assertion is the one that catches a "fix" that quietly repairs the
 * tree to [] and lets the next save destroy it.
 *
 * A new tree walker belongs in this list. Adding it costs one line.
 */

/**
 * `returnsTree` marks the walkers that hand a rebuilt tree back. For those the
 * malformed values must be identical in the RESULT too, not merely in the input:
 * that is what catches a walker which re-spreads a folder it was not targeting
 * and quietly replaces its unreadable value with [].
 */
type Sweep = [
	name: string,
	run: (tree: IChoice[]) => unknown,
	returnsTree?: boolean,
];

const sweeps: Sweep[] = [
	// --- choiceUtils
	["flattenChoices", (t) => flattenChoices(t)],
	["flattenChoicesWithPath", (t) => flattenChoicesWithPath(t)],
	["dedupeChoicesById", (t) => dedupeChoicesById(t), true],
	["childChoicesOf (every node)", (t) => t.map((c) => childChoicesOf(c))],
	["hasChildChoices (every node)", (t) => t.map((c) => hasChildChoices(c))],
	[
		"hasUnreadableChildren (every node)",
		(t) => t.map((c) => hasUnreadableChildren(c)),
	],
	["rootChoicesOf", (t) => rootChoicesOf(t), true],
	[
		"resolveChoiceIcon (every readable node)",
		(t) => flattenChoices(t).map((c) => resolveChoiceIcon(c)),
	],

	// --- choiceService: lookups
	["findChoiceById (hit)", (t) => findChoiceById(t, "child")],
	["findChoiceById (miss)", (t) => findChoiceById(t, "nope")],

	// --- choiceService: edits elsewhere in the tree
	["removeChoiceById (leaf)", (t) => removeChoiceById(t, "child").updated, true],
	["removeChoiceById (malformed folder)", (t) => removeChoiceById(t, "broken-null").updated],
	["insertChoiceAfter", (t) => insertChoiceAfter(t, "child", leaf("New", "new")), true],
	["insertIntoMulti (healthy target)", (t) => insertIntoMulti(t, "healthy", leaf("New", "new")), true],
	["addChoiceToTree (root)", (t) => addChoiceToTree(t, leaf("New", "new")), true],
	["addChoiceToTree (into folder)", (t) => addChoiceToTree(t, leaf("New", "new"), "healthy"), true],
	["setMultiCollapsedById", (t) => setMultiCollapsedById(t, "healthy", true), true],
	["setFolderChildrenById", (t) => setFolderChildrenById(t, "healthy", []), true],
	["updateMultiById (no match)", (t) => updateMultiById(t, "nope", (f) => f), true],
	["moveChoice", (t) => moveChoice(t, "head", "healthy"), true],
	["moveChoiceToRoot", (t) => moveChoiceToRoot(t, "child"), true],
	["duplicateChoice (every node)", (t) => t.filter(isChoiceLike).map((c) => duplicateChoice(c))],

	// --- packages
	["collectChoiceClosure (healthy root)", (t) => collectChoiceClosure(t, ["healthy"])],
	[
		"collectChoiceClosure (every node as root)",
		(t) => collectChoiceClosure(t, t.filter(isChoiceLike).map((c) => c.id)),
	],

	// --- settings GUI helpers
	["isChoiceNested (every node)", (t) => t.filter(isChoiceLike).map((c) => isChoiceNested(c, t))],
	[
		"computeEligibleMultiTargets (every node)",
		(t) => t.filter(isChoiceLike).map((c) => computeEligibleMultiTargets(c, t)),
	],
	["uniqueDefaultChoiceName", (t) => uniqueDefaultChoiceName("Multi", t)],

	// --- picker
	["isEmptyFolderChoice (every node)", (t) => t.filter(isChoiceLike).map((c) => isEmptyFolderChoice(c))],
	["folderFlairFor (every node)", (t) => t.filter(isChoiceLike).map((c) => folderFlairFor(c))],
	[
		"emptyFolderNoticeText (every node)",
		(t) => t.filter(isChoiceLike).map((c) => emptyFolderNoticeText(c)),
	],

	// --- macro builder
	["getChoicesAsList", (t) => macroBuilderChoiceList(t)],

	// --- macro command lists (#1593). Same argument as the folder walkers above,
	// one type over: `macro.commands` is declared ICommand[] and read raw.
	[
		"commandListOf (every macro)",
		(t) => macrosIn(t).map((m) => commandListOf(m?.commands)),
	],
	[
		"hasCommandList (every macro)",
		(t) => macrosIn(t).map((m) => hasCommandList(m?.commands)),
	],
	[
		"isUnreadableCommandList (every macro)",
		(t) => macrosIn(t).map((m) => isUnreadableCommandList(m?.commands)),
	],
	[
		"normalizeCommandList (every macro)",
		(t) => macrosIn(t).map((m) => normalizeCommandList(m?.commands)),
	],
	[
		"regenerateIds (every macro)",
		// A WRITE path (duplicateChoice). Runs over a CLONE so the shared fixture
		// tree keeps its ids; the point is that it neither throws nor rewrites an
		// unreadable value.
		(t) => macrosIn(structuredCloneTree(t)).map((m) => regenerateIds(m as unknown as IMacro)),
	],
	[
		"buildPackagePreview (whole tree as a package)",
		(t) => buildPackagePreview([], packageOf(t), new Set()),
	],
];

/**
 * The malformed tree wrapped as an importable package, for the preview walker.
 * Structurally typed, with NO cast: a cast here would let the fixture drift out
 * of the shape the walker is handed in production, which is the one thing this
 * sweep is for.
 */
function packageOf(tree: IChoice[]): QuickAddPackage {
	const roots = tree.filter(isChoiceLike);
	return {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion: "1.18.0",
		createdAt: "2026-06-01T00:00:00.000Z",
		rootChoiceIds: roots.map((c) => c.id),
		choices: roots.map((choice) => ({
			choice,
			pathHint: [choice.name],
			parentChoiceId: null,
		})),
		assets: [],
	};
}

/** Every `macro` object in the tree, including the unreadable ones. */
function macrosIn(tree: IChoice[]): (Record<string, unknown> | null)[] {
	const out: (Record<string, unknown> | null)[] = [];
	const walk = (list: unknown) => {
		if (!Array.isArray(list)) return;
		for (const entry of list) {
			if (typeof entry !== "object" || entry === null) continue;
			const node = entry as Record<string, unknown>;
			if (node.type === "Macro") {
				out.push(
					typeof node.macro === "object"
						? (node.macro as Record<string, unknown> | null)
						: null,
				);
			}
			if (node.type === "Multi") walk(node.choices);
		}
	};
	walk(tree);
	return out;
}

function structuredCloneTree(tree: IChoice[]): IChoice[] {
	return JSON.parse(JSON.stringify(tree)) as IChoice[];
}


describe("every choice-tree entry point over a malformed tree (#1566)", () => {
	it.each(sweeps)("%s does not throw", (_name, run) => {
		expect(() => run(malformedTree())).not.toThrow();
	});

	it.each(sweeps)(
		"%s leaves every malformed value untouched",
		(_name, run, returnsTree) => {
			const tree = malformedTree();
			const before = malformedSnapshot(tree);

			const result = run(tree);

			// The input tree is never mutated...
			expect(malformedSnapshot(tree)).toBe(before);
			// ...and a rebuilt tree carries the same values back out.
			if (returnsTree) {
				expect(malformedSnapshot(result as IChoice[])).toBe(before);
			}
		},
	);

	it("keeps every healthy choice reachable through the flatteners", () => {
		const flat = flattenChoices(malformedTree()).map((c) => c.id);
		for (const id of HEALTHY_IDS) expect(flat).toContain(id);

		const withPath = flattenChoicesWithPath(malformedTree()).map((e) => e.id);
		for (const id of HEALTHY_IDS) expect(withPath).toContain(id);
	});

	it("survives a root `choices` that is not a list at all", () => {
		for (const root of [undefined, null, {}, "nope", 7]) {
			const t = root as unknown as IChoice[];
			expect(() => flattenChoices(t), String(root)).not.toThrow();
			expect(() => flattenChoicesWithPath(t), String(root)).not.toThrow();
			expect(() => rootChoicesOf(t), String(root)).not.toThrow();
		}
	});
});
