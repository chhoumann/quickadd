import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type {
	QuickAddPackage,
	QuickAddPackageAsset,
	QuickAddPackageChoice,
} from "../types/packages/QuickAddPackage";
import { QUICKADD_PACKAGE_SCHEMA_VERSION } from "../types/packages/QuickAddPackage";
import { CommandType } from "../types/macros/CommandType";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import { encodeToBase64 } from "../utils/base64";

// Make uuid deterministic so duplicated-id remapping is verifiable.
const uuidMock = vi.hoisted(() => ({ counter: 0 }));
vi.mock("uuid", () => ({
	v4: () => `uuid-${++uuidMock.counter}`,
}));

import {
	parseQuickAddPackage,
	readQuickAddPackage,
	analysePackage,
	applyPackageImport,
} from "./packageImportService";
import type {
	ChoiceImportDecision,
	AssetImportDecision,
} from "./packageImportService";

// --- Fake app / vault -------------------------------------------------------

interface FakeVaultState {
	existingPaths: Set<string>;
	writes: Map<string, string>;
	createdFolders: string[];
	existThrowsFor?: Set<string>;
}

function createFakeApp(initialExisting: string[] = []): {
	app: App;
	state: FakeVaultState;
} {
	const state: FakeVaultState = {
		existingPaths: new Set(initialExisting),
		writes: new Map(),
		createdFolders: [],
	};

	const adapter = {
		exists: vi.fn(async (path: string) => {
			if (state.existThrowsFor?.has(path)) {
				throw new Error(`boom: ${path}`);
			}
			return state.existingPaths.has(path);
		}),
		read: vi.fn(async (path: string) => {
			const content = state.writes.get(path);
			if (content === undefined) {
				throw new Error(`no file at ${path}`);
			}
			return content;
		}),
		write: vi.fn(async (path: string, content: string) => {
			state.writes.set(path, content);
			state.existingPaths.add(path);
		}),
	};

	const app = {
		vault: {
			adapter,
			createFolder: vi.fn(async (path: string) => {
				state.createdFolders.push(path);
				state.existingPaths.add(path);
			}),
		},
	} as unknown as App;

	return { app, state };
}

// --- Fixture builders -------------------------------------------------------

function makeChoice(
	id: string,
	name: string,
	type: IChoice["type"],
	overrides: Partial<IChoice> = {},
): IChoice {
	return {
		id,
		name,
		type,
		command: false,
		...overrides,
	} as IChoice;
}

function makeMulti(
	id: string,
	name: string,
	children: IChoice[] = [],
): IMultiChoice {
	return {
		id,
		name,
		type: "Multi",
		command: false,
		collapsed: false,
		choices: children,
	} as IMultiChoice;
}

function makePackageChoice(
	choice: IChoice,
	parentChoiceId: string | null = null,
	pathHint: string[] = [],
): QuickAddPackageChoice {
	return { choice, parentChoiceId, pathHint };
}

function makePackage(
	overrides: Partial<QuickAddPackage> = {},
): QuickAddPackage {
	return {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion: "1.0.0",
		createdAt: "2025-01-01T00:00:00.000Z",
		rootChoiceIds: [],
		choices: [],
		assets: [],
		...overrides,
	};
}

function decisions(
	entries: Array<[string, ChoiceImportDecision["mode"]]>,
): ChoiceImportDecision[] {
	return entries.map(([choiceId, mode]) => ({ choiceId, mode }));
}

beforeEach(() => {
	uuidMock.counter = 0;
});

// --- parseQuickAddPackage ---------------------------------------------------

describe("parseQuickAddPackage", () => {
	it("parses a valid package payload", () => {
		const pkg = makePackage({
			rootChoiceIds: ["a"],
			choices: [makePackageChoice(makeChoice("a", "A", "Template"))],
		});
		const result = parseQuickAddPackage(JSON.stringify(pkg));
		expect(result.schemaVersion).toBe(QUICKADD_PACKAGE_SCHEMA_VERSION);
		expect(result.choices).toHaveLength(1);
		expect(result.choices[0].choice.id).toBe("a");
	});

	it("throws on invalid JSON", () => {
		expect(() => parseQuickAddPackage("{not json")).toThrow(
			/not valid JSON/,
		);
	});

	it("throws when the payload is not a QuickAdd package", () => {
		expect(() => parseQuickAddPackage(JSON.stringify({ foo: "bar" }))).toThrow(
			/not a valid QuickAdd package/,
		);
	});

	it("throws a version-specific error when the schema version is newer than supported", () => {
		const future = {
			...makePackage(),
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION + 1,
		};
		expect(() => parseQuickAddPackage(JSON.stringify(future))).toThrow(
			/newer than this plugin supports/,
		);
	});

	it("rejects a package whose choices are missing required fields", () => {
		const bad = makePackage({
			choices: [{ choice: { id: "x" }, parentChoiceId: null, pathHint: [] }],
		} as unknown as Partial<QuickAddPackage>);
		expect(() => parseQuickAddPackage(JSON.stringify(bad))).toThrow(
			/not a valid QuickAdd package/,
		);
	});

	it("rejects a package with an invalid asset kind", () => {
		const bad = makePackage({
			assets: [
				{
					kind: "not-a-kind",
					originalPath: "scripts/x.js",
					contentEncoding: "base64",
					content: "",
				},
			],
		} as unknown as Partial<QuickAddPackage>);
		expect(() => parseQuickAddPackage(JSON.stringify(bad))).toThrow(
			/not a valid QuickAdd package/,
		);
	});
});

// --- readQuickAddPackage ----------------------------------------------------

describe("readQuickAddPackage", () => {
	it("throws on an empty path", async () => {
		const { app } = createFakeApp();
		await expect(readQuickAddPackage(app, "   ")).rejects.toThrow(
			/cannot be empty/,
		);
	});

	it("throws when the file does not exist", async () => {
		const { app } = createFakeApp();
		await expect(
			readQuickAddPackage(app, "packages/missing.json"),
		).rejects.toThrow(/Package file not found/);
	});

	it("normalizes the path, reads, and parses the package", async () => {
		const { app, state } = createFakeApp();
		const pkg = makePackage({
			rootChoiceIds: ["a"],
			choices: [makePackageChoice(makeChoice("a", "A", "Template"))],
		});
		// Windows-style separators get normalized to POSIX by normalizePath stub.
		state.existingPaths.add("packages/p.json");
		state.writes.set("packages/p.json", JSON.stringify(pkg));

		const loaded = await readQuickAddPackage(app, "packages\\p.json");
		expect(loaded.path).toBe("packages/p.json");
		expect(loaded.pkg.choices[0].choice.id).toBe("a");
	});
});

// --- analysePackage ---------------------------------------------------------

describe("analysePackage", () => {
	it("flags choice conflicts for ids that already exist (incl. nested)", async () => {
		const { app } = createFakeApp();
		const existing: IChoice[] = [
			makeMulti("parent", "Parent", [makeChoice("nested", "Nested", "Template")]),
		];
		const pkg = makePackage({
			choices: [
				makePackageChoice(makeChoice("nested", "Nested", "Template"), null, [
					"Parent",
				]),
				makePackageChoice(makeChoice("fresh", "Fresh", "Template")),
			],
		});

		const analysis = await analysePackage(app, existing, pkg);
		expect(analysis.choiceConflicts).toEqual([
			{
				choiceId: "nested",
				name: "Nested",
				parentChoiceId: null,
				pathHint: ["Parent"],
				exists: true,
			},
			{
				choiceId: "fresh",
				name: "Fresh",
				parentChoiceId: null,
				pathHint: [],
				exists: false,
			},
		]);
	});

	it("defaults missing pathHint to an empty array", async () => {
		const { app } = createFakeApp();
		const entry = {
			choice: makeChoice("a", "A", "Template"),
			parentChoiceId: null,
		} as unknown as QuickAddPackageChoice;
		const pkg = makePackage({ choices: [entry] });

		const analysis = await analysePackage(app, [], pkg);
		expect(analysis.choiceConflicts[0].pathHint).toEqual([]);
	});

	it("reports asset conflicts based on vault existence", async () => {
		const { app } = createFakeApp(["scripts/exists.js"]);
		const pkg = makePackage({
			assets: [
				{
					kind: "user-script",
					originalPath: "scripts/exists.js",
					contentEncoding: "base64",
					content: "",
				},
				{
					kind: "template",
					originalPath: "templates/new.md",
					contentEncoding: "base64",
					content: "",
				},
			],
		});

		const analysis = await analysePackage(app, [], pkg);
		expect(analysis.assetConflicts).toEqual([
			{ originalPath: "scripts/exists.js", exists: true, kind: "user-script" },
			{ originalPath: "templates/new.md", exists: false, kind: "template" },
		]);
	});
});

// --- applyPackageImport: basic insertion -----------------------------------

describe("applyPackageImport - root insertion", () => {
	it("appends a brand-new root choice", async () => {
		const { app } = createFakeApp();
		const pkg = makePackage({
			choices: [makePackageChoice(makeChoice("new", "New", "Template"))],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: decisions([["new", "import"]]),
			assetDecisions: [],
		});

		expect(result.addedChoiceIds).toEqual(["new"]);
		expect(result.overwrittenChoiceIds).toEqual([]);
		expect(result.updatedChoices.map((c) => c.id)).toEqual(["new"]);
	});

	it("overwrites an existing root choice in place", async () => {
		const { app } = createFakeApp();
		const existing: IChoice[] = [makeChoice("dup", "Old Name", "Template")];
		const pkg = makePackage({
			choices: [makePackageChoice(makeChoice("dup", "New Name", "Template"))],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: existing,
			pkg,
			choiceDecisions: decisions([["dup", "overwrite"]]),
			assetDecisions: [],
		});

		expect(result.overwrittenChoiceIds).toEqual(["dup"]);
		expect(result.addedChoiceIds).toEqual([]);
		expect(result.updatedChoices).toHaveLength(1);
		expect(result.updatedChoices[0].name).toBe("New Name");
	});

	it("does not mutate the passed-in existingChoices array", async () => {
		const { app } = createFakeApp();
		const existing: IChoice[] = [makeChoice("dup", "Old Name", "Template")];
		const pkg = makePackage({
			choices: [makePackageChoice(makeChoice("dup", "New Name", "Template"))],
		});

		await applyPackageImport({
			app,
			existingChoices: existing,
			pkg,
			choiceDecisions: decisions([["dup", "overwrite"]]),
			assetDecisions: [],
		});

		// Original input untouched (deepClone is used internally).
		expect(existing).toHaveLength(1);
		expect(existing[0].name).toBe("Old Name");
	});

	it("skips a choice marked skip and reports it", async () => {
		const { app } = createFakeApp();
		const pkg = makePackage({
			choices: [
				makePackageChoice(makeChoice("keep", "Keep", "Template")),
				makePackageChoice(makeChoice("drop", "Drop", "Template")),
			],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: decisions([
				["keep", "import"],
				["drop", "skip"],
			]),
			assetDecisions: [],
		});

		expect(result.skippedChoiceIds).toEqual(["drop"]);
		expect(result.addedChoiceIds).toEqual(["keep"]);
		expect(result.updatedChoices.map((c) => c.id)).toEqual(["keep"]);
	});
});

// --- applyPackageImport: parent/child handling ------------------------------

describe("applyPackageImport - parent/child trees", () => {
	it("inserts the multi parent (with children) and skips re-inserting children", async () => {
		const { app } = createFakeApp();
		const child = makeChoice("child", "Child", "Template");
		const parent = makeMulti("parent", "Parent", [child]);
		const pkg = makePackage({
			choices: [
				makePackageChoice(parent),
				makePackageChoice(child, "parent", ["Parent"]),
			],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: decisions([
				["parent", "import"],
				["child", "import"],
			]),
			assetDecisions: [],
		});

		// Parent added once at root; child handled inside the parent's tree.
		expect(result.addedChoiceIds).toEqual(["parent"]);
		expect(result.updatedChoices).toHaveLength(1);
		const insertedParent = result.updatedChoices[0] as IMultiChoice;
		expect(insertedParent.id).toBe("parent");
		expect(insertedParent.choices.map((c) => c.id)).toEqual(["child"]);
	});

	it("inserts a new child under an already-existing parent multi", async () => {
		const { app } = createFakeApp();
		const existing: IChoice[] = [makeMulti("parent", "Parent", [])];
		const child = makeChoice("child", "Child", "Template");
		const pkg = makePackage({
			choices: [makePackageChoice(child, "parent", ["Parent"])],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: existing,
			pkg,
			choiceDecisions: decisions([["child", "import"]]),
			assetDecisions: [],
		});

		expect(result.addedChoiceIds).toEqual(["child"]);
		const parent = result.updatedChoices[0] as IMultiChoice;
		expect(parent.choices.map((c) => c.id)).toEqual(["child"]);
	});

	it("falls back to pathHint to locate a parent multi by name", async () => {
		const { app } = createFakeApp();
		// Existing parent has a DIFFERENT id than the package's parentChoiceId,
		// so id-based lookup fails and the pathHint name lookup kicks in.
		const existing: IChoice[] = [makeMulti("local-parent-id", "Parent", [])];
		const child = makeChoice("child", "Child", "Template");
		// pathHint is the full path INCLUDING the choice's own name; the parent
		// path is everything before the last segment (slice(0, -1) === ["Parent"]).
		const pkg = makePackage({
			choices: [
				makePackageChoice(child, "missing-parent-id", ["Parent", "Child"]),
			],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: existing,
			pkg,
			choiceDecisions: decisions([["child", "import"]]),
			assetDecisions: [],
		});

		expect(result.addedChoiceIds).toEqual(["child"]);
		const parent = result.updatedChoices[0] as IMultiChoice;
		expect(parent.choices.map((c) => c.id)).toEqual(["child"]);
	});

	it("adds an orphan child to the root when its parent cannot be found", async () => {
		const { app } = createFakeApp();
		const child = makeChoice("child", "Child", "Template");
		const pkg = makePackage({
			// parentChoiceId references something that's not in the package and
			// no matching pathHint exists in the (empty) destination tree.
			choices: [
				makePackageChoice(child, "ghost-parent", ["Nonexistent", "Child"]),
			],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: decisions([["child", "import"]]),
			assetDecisions: [],
		});

		expect(result.addedChoiceIds).toEqual(["child"]);
		expect(result.updatedChoices.map((c) => c.id)).toEqual(["child"]);
	});

	it("treats a child importable even when its in-package parent is skipped", async () => {
		const { app } = createFakeApp();
		const existing: IChoice[] = [makeMulti("parent", "Parent", [])];
		const child = makeChoice("child", "Child", "Template");
		const parent = makeMulti("parent", "Parent", [child]);
		const pkg = makePackage({
			choices: [
				makePackageChoice(parent),
				makePackageChoice(child, "parent", ["Parent"]),
			],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: existing,
			pkg,
			choiceDecisions: decisions([
				["parent", "skip"],
				["child", "import"],
			]),
			assetDecisions: [],
		});

		// Parent skipped, child should still be importable and land under the
		// existing parent multi via id lookup.
		expect(result.skippedChoiceIds).toEqual(["parent"]);
		expect(result.addedChoiceIds).toEqual(["child"]);
		const destParent = result.updatedChoices.find(
			(c) => c.id === "parent",
		) as IMultiChoice;
		expect(destParent.choices.map((c) => c.id)).toEqual(["child"]);
	});
});

// --- applyPackageImport: duplicate / id remapping ---------------------------

describe("applyPackageImport - duplicate mode and id remapping", () => {
	it("assigns a fresh id when a choice is duplicated", async () => {
		const { app } = createFakeApp();
		const pkg = makePackage({
			choices: [makePackageChoice(makeChoice("orig", "Orig", "Template"))],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: decisions([["orig", "duplicate"]]),
			assetDecisions: [],
		});

		expect(result.addedChoiceIds).toEqual(["uuid-1"]);
		expect(result.updatedChoices[0].id).toBe("uuid-1");
		expect(result.updatedChoices[0].name).toBe("Orig");
	});

	it("propagates duplication to descendants and regenerates macro/command ids", async () => {
		const { app } = createFakeApp();
		const macroChild = {
			...makeChoice("macroChild", "MacroChild", "Macro"),
			macro: {
				id: "macro-orig",
				name: "M",
				commands: [
					{
						id: "cmd-orig",
						name: "Run sibling",
						type: CommandType.Choice,
						choiceId: "macroChild",
					} as IChoiceCommand,
				],
			},
			runOnStartup: false,
		} as IMacroChoice;
		const parent = makeMulti("parent", "Parent", [macroChild]);
		const pkg = makePackage({
			choices: [
				makePackageChoice(parent),
				makePackageChoice(macroChild, "parent", ["Parent"]),
			],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			// Only the parent is marked duplicate; the child should inherit it.
			choiceDecisions: decisions([
				["parent", "duplicate"],
				["macroChild", "import"],
			]),
			assetDecisions: [],
		});

		const insertedParent = result.updatedChoices[0] as IMultiChoice;
		// Parent and child both get new ids.
		expect(insertedParent.id).not.toBe("parent");
		const insertedMacro = insertedParent.choices[0] as IMacroChoice;
		expect(insertedMacro.id).not.toBe("macroChild");
		// Macro + command ids regenerated.
		expect(insertedMacro.macro.id).not.toBe("macro-orig");
		const cmd = insertedMacro.macro.commands[0] as IChoiceCommand;
		expect(cmd.id).not.toBe("cmd-orig");
		// Choice command pointing at the duplicated child gets remapped to the new id.
		expect(cmd.choiceId).toBe(insertedMacro.id);
	});

	it("remaps Choice-command references to non-duplicated imported ids", async () => {
		const { app } = createFakeApp();
		const macro = {
			...makeChoice("macro", "Macro", "Macro"),
			macro: {
				id: "macro-id",
				name: "M",
				commands: [
					{
						id: "cmd",
						name: "Run target",
						type: CommandType.Choice,
						choiceId: "target",
					} as IChoiceCommand,
				],
			},
			runOnStartup: false,
		} as IMacroChoice;
		const target = makeChoice("target", "Target", "Template");
		const pkg = makePackage({
			choices: [makePackageChoice(macro), makePackageChoice(target)],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: decisions([
				["macro", "import"],
				["target", "import"],
			]),
			assetDecisions: [],
		});

		const insertedMacro = result.updatedChoices.find(
			(c) => c.id === "macro",
		) as IMacroChoice;
		const cmd = insertedMacro.macro.commands[0] as IChoiceCommand;
		// Not duplicated, so id stays the same.
		expect(cmd.choiceId).toBe("target");
	});

	it("filters out non-importable children from a Multi during remap", async () => {
		const { app } = createFakeApp();
		const keepChild = makeChoice("keep", "Keep", "Template");
		const dropChild = makeChoice("drop", "Drop", "Template");
		const parent = makeMulti("parent", "Parent", [keepChild, dropChild]);
		const pkg = makePackage({
			choices: [
				makePackageChoice(parent),
				makePackageChoice(keepChild, "parent", ["Parent"]),
				makePackageChoice(dropChild, "parent", ["Parent"]),
			],
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: decisions([
				["parent", "import"],
				["keep", "import"],
				["drop", "skip"],
			]),
			assetDecisions: [],
		});

		const insertedParent = result.updatedChoices[0] as IMultiChoice;
		// The skipped child must not appear inside the imported parent's tree.
		expect(insertedParent.choices.map((c) => c.id)).toEqual(["keep"]);
		expect(result.skippedChoiceIds).toContain("drop");
	});
});

// --- applyPackageImport: assets ---------------------------------------------

describe("applyPackageImport - assets", () => {
	it("writes a new asset, ensures parent folders, and decodes base64 content", async () => {
		const { app, state } = createFakeApp();
		const content = "console.log('hi');";
		const asset: QuickAddPackageAsset = {
			kind: "user-script",
			originalPath: "scripts/sub/run.js",
			contentEncoding: "base64",
			content: encodeToBase64(content),
		};
		const pkg = makePackage({ assets: [asset] });

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [],
			assetDecisions: [],
		});

		expect(result.writtenAssets).toEqual(["scripts/sub/run.js"]);
		expect(state.writes.get("scripts/sub/run.js")).toBe(content);
		// Parent folders created in order.
		expect(state.createdFolders).toEqual(["scripts", "scripts/sub"]);
	});

	it("respects an explicit skip decision for an asset", async () => {
		const { app, state } = createFakeApp();
		const asset: QuickAddPackageAsset = {
			kind: "template",
			originalPath: "templates/t.md",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });
		const assetDecisions: AssetImportDecision[] = [
			{
				originalPath: "templates/t.md",
				destinationPath: "templates/t.md",
				mode: "skip",
			},
		];

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [],
			assetDecisions,
		});

		expect(result.skippedAssets).toEqual(["templates/t.md"]);
		expect(result.writtenAssets).toEqual([]);
		expect(state.writes.has("templates/t.md")).toBe(false);
	});

	it("writes to a custom (normalized) destination path", async () => {
		const { app, state } = createFakeApp();
		const asset: QuickAddPackageAsset = {
			kind: "template",
			originalPath: "templates/t.md",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });
		const assetDecisions: AssetImportDecision[] = [
			{
				originalPath: "templates/t.md",
				destinationPath: "renamed\\dest.md",
				mode: "write",
			},
		];

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [],
			assetDecisions,
		});

		expect(result.writtenAssets).toEqual(["renamed/dest.md"]);
		expect(state.writes.get("renamed/dest.md")).toBe("body");
	});

	it("rejects traversal in an asset's original path", async () => {
		const { app, state } = createFakeApp();
		const asset: QuickAddPackageAsset = {
			kind: "template",
			originalPath: "../escape.md",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });

		await expect(
			applyPackageImport({
				app,
				existingChoices: [],
				pkg,
				choiceDecisions: [],
				assetDecisions: [],
			}),
		).rejects.toThrow(/traversal|\.\./);

		expect(state.writes.size).toBe(0);
	});

	it("rejects traversal in an asset destination override", async () => {
		const { app, state } = createFakeApp();
		const asset: QuickAddPackageAsset = {
			kind: "template",
			originalPath: "templates/t.md",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });

		await expect(
			applyPackageImport({
				app,
				existingChoices: [],
				pkg,
				choiceDecisions: [],
				assetDecisions: [
					{
						originalPath: "templates/t.md",
						destinationPath: "../../evil.md",
						mode: "write",
					},
				],
			}),
		).rejects.toThrow(/traversal|\.\./);

		expect(state.writes.size).toBe(0);
	});

	it("rejects an absolute asset destination override", async () => {
		const { app, state } = createFakeApp();
		const asset: QuickAddPackageAsset = {
			kind: "template",
			originalPath: "templates/t.md",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });

		await expect(
			applyPackageImport({
				app,
				existingChoices: [],
				pkg,
				choiceDecisions: [],
				assetDecisions: [
					{
						originalPath: "templates/t.md",
						destinationPath: "/abs/path.md",
						mode: "write",
					},
				],
			}),
		).rejects.toThrow(/absolute path/);

		expect(state.writes.size).toBe(0);
	});

	it("rejects assets targeting dotfile config directories", async () => {
		const { app, state } = createFakeApp();
		const asset: QuickAddPackageAsset = {
			kind: "template",
			originalPath: ".obsidian/plugins/x/main.js",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });

		await expect(
			applyPackageImport({
				app,
				existingChoices: [],
				pkg,
				choiceDecisions: [],
				assetDecisions: [],
			}),
		).rejects.toThrow(/config directory/);

		expect(state.writes.size).toBe(0);
	});

	it("allows url-encoded traversal text as a literal filename", async () => {
		const { app, state } = createFakeApp();
		const asset: QuickAddPackageAsset = {
			kind: "template",
			originalPath: "..%2fevil.md",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [],
			assetDecisions: [],
		});

		expect(result.writtenAssets).toEqual(["..%2fevil.md"]);
		expect(state.writes.get("..%2fevil.md")).toBe("body");
	});

	it("allows a legitimate asset path", async () => {
		const { app, state } = createFakeApp();
		const asset: QuickAddPackageAsset = {
			kind: "template",
			originalPath: "Templates/foo.md",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [],
			assetDecisions: [],
		});

		expect(result.writtenAssets).toEqual(["Templates/foo.md"]);
		expect(state.writes.get("Templates/foo.md")).toBe("body");
	});

	it("rewrites template/userscript/conditional paths to remapped destinations", async () => {
		const { app } = createFakeApp();

		const templateChoice = {
			...makeChoice("tmpl", "Template choice", "Template"),
			templatePath: "templates/orig.md",
		} as ITemplateChoice;

		const captureChoice = {
			...makeChoice("cap", "Capture choice", "Capture"),
			createFileIfItDoesntExist: {
				enabled: true,
				createWithTemplate: true,
				template: "templates/orig.md",
			},
		} as ICaptureChoice;

		const macroChoice = {
			...makeChoice("macro", "Macro choice", "Macro"),
			macro: {
				id: "macro-id",
				name: "M",
				commands: [
					{
						id: "us",
						name: "Script",
						type: CommandType.UserScript,
						path: "scripts/orig.js",
						settings: {},
					} as IUserScript,
					{
						id: "cond",
						name: "Cond",
						type: CommandType.Conditional,
						condition: {
							mode: "script",
							scriptPath: "scripts/orig.js",
						},
						thenCommands: [
							{
								id: "nested",
								name: "Nested",
								type: CommandType.NestedChoice,
								choice: {
									...makeChoice("nestedTmpl", "Nested tmpl", "Template"),
									templatePath: "templates/orig.md",
								} as ITemplateChoice,
							} as INestedChoiceCommand,
						],
						elseCommands: [],
					} as IConditionalCommand,
				],
			},
			runOnStartup: false,
		} as IMacroChoice;

		const pkg = makePackage({
			choices: [
				makePackageChoice(templateChoice),
				makePackageChoice(captureChoice),
				makePackageChoice(macroChoice),
			],
			assets: [
				{
					kind: "template",
					originalPath: "templates/orig.md",
					contentEncoding: "base64",
					content: encodeToBase64("tmpl body"),
				},
				{
					kind: "user-script",
					originalPath: "scripts/orig.js",
					contentEncoding: "base64",
					content: encodeToBase64("script body"),
				},
			],
		});

		const assetDecisions: AssetImportDecision[] = [
			{
				originalPath: "templates/orig.md",
				destinationPath: "templates/new.md",
				mode: "write",
			},
			{
				originalPath: "scripts/orig.js",
				destinationPath: "scripts/new.js",
				mode: "write",
			},
		];

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: decisions([
				["tmpl", "import"],
				["cap", "import"],
				["macro", "import"],
			]),
			assetDecisions,
		});

		const insertedTemplate = result.updatedChoices.find(
			(c) => c.id === "tmpl",
		) as ITemplateChoice;
		expect(insertedTemplate.templatePath).toBe("templates/new.md");

		const insertedCapture = result.updatedChoices.find(
			(c) => c.id === "cap",
		) as ICaptureChoice;
		expect(insertedCapture.createFileIfItDoesntExist.template).toBe(
			"templates/new.md",
		);

		const insertedMacro = result.updatedChoices.find(
			(c) => c.id === "macro",
		) as IMacroChoice;
		const userScript = insertedMacro.macro.commands[0] as IUserScript;
		expect(userScript.path).toBe("scripts/new.js");
		const conditional = insertedMacro.macro.commands[1] as IConditionalCommand;
		expect(
			(conditional.condition as { scriptPath: string }).scriptPath,
		).toBe("scripts/new.js");
		const nested = conditional.thenCommands[0] as INestedChoiceCommand;
		expect((nested.choice as ITemplateChoice).templatePath).toBe(
			"templates/new.md",
		);
	});

	it("does not throw when adapter.exists rejects while checking an asset", async () => {
		const { app, state } = createFakeApp();
		state.existThrowsFor = new Set(["scripts/run.js"]);
		const asset: QuickAddPackageAsset = {
			kind: "user-script",
			originalPath: "scripts/run.js",
			contentEncoding: "base64",
			content: encodeToBase64("body"),
		};
		const pkg = makePackage({ assets: [asset] });

		// exists() throws -> assetExists swallows -> treated as not existing -> write.
		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [],
			assetDecisions: [],
		});

		expect(result.writtenAssets).toEqual(["scripts/run.js"]);
	});

	it("returns empty result arrays for an empty package", async () => {
		const { app } = createFakeApp();
		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg: makePackage(),
			choiceDecisions: [],
			assetDecisions: [],
		});

		expect(result).toEqual({
			updatedChoices: [],
			addedChoiceIds: [],
			overwrittenChoiceIds: [],
			skippedChoiceIds: [],
			writtenAssets: [],
			skippedAssets: [],
		});
	});
});
