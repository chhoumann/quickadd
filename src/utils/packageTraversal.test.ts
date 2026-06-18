import { describe, it, expect } from "vitest";
import {
	collectChoiceClosure,
	collectScriptDependencies,
	collectFileDependencies,
	type ChoiceCatalogEntry,
} from "./packageTraversal";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { ICommand } from "../types/macros/ICommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import { CommandType } from "../types/macros/CommandType";

// --- Factory helpers (typed, minimal, no Obsidian deps) -----------------

let idCounter = 0;
function uid(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

function makeMulti(
	name: string,
	children: IChoice[],
	id = uid("multi"),
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

function makeTemplate(
	name: string,
	templatePath: string,
	id = uid("template"),
): ITemplateChoice {
	return {
		id,
		name,
		type: "Template",
		command: false,
		templatePath,
	} as unknown as ITemplateChoice;
}

function makeCapture(
	name: string,
	createFileIfItDoesntExist?: ICaptureChoice["createFileIfItDoesntExist"],
	id = uid("capture"),
): ICaptureChoice {
	return {
		id,
		name,
		type: "Capture",
		command: false,
		createFileIfItDoesntExist,
	} as unknown as ICaptureChoice;
}

function makeMacro(
	name: string,
	commands: ICommand[],
	id = uid("macro"),
): IMacroChoice {
	return {
		id,
		name,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: uid("macroDef"),
			name: `${name}-macro`,
			commands,
		},
	} as unknown as IMacroChoice;
}

function choiceCommand(choiceId: string, id = uid("cmd")): IChoiceCommand {
	return {
		id,
		name: "choice-cmd",
		type: CommandType.Choice,
		choiceId,
	};
}

function nestedChoiceCommand(
	choice: IChoice,
	id = uid("cmd"),
): INestedChoiceCommand {
	return {
		id,
		name: "nested-cmd",
		type: CommandType.NestedChoice,
		choice,
	};
}

function userScriptCommand(path: string, id = uid("cmd")): IUserScript {
	return {
		id,
		name: "user-script",
		type: CommandType.UserScript,
		path,
		settings: {},
	};
}

function conditionalCommand(
	condition: IConditionalCommand["condition"],
	thenCommands: ICommand[],
	elseCommands: ICommand[],
	id = uid("cmd"),
): IConditionalCommand {
	return {
		id,
		name: "conditional",
		type: CommandType.Conditional,
		condition,
		thenCommands,
		elseCommands,
	};
}

const scriptCondition = (scriptPath: string): IConditionalCommand["condition"] =>
	({ mode: "script", scriptPath } as IConditionalCommand["condition"]);

const variableCondition = (): IConditionalCommand["condition"] =>
	({
		mode: "variable",
		variableName: "x",
		operator: "isTruthy",
		valueType: "boolean",
	} as IConditionalCommand["condition"]);

// --- collectChoiceClosure -----------------------------------------------

describe("collectChoiceClosure", () => {
	it("returns empty results for empty inputs", () => {
		const result = collectChoiceClosure([], []);
		expect(result.choiceIds).toEqual([]);
		expect(result.missingChoiceIds).toEqual([]);
		expect(result.catalog.size).toBe(0);
	});

	it("builds a catalog with parentId and path for nested multi choices", () => {
		const leaf = makeTemplate("Leaf", "T.md", "leaf");
		const inner = makeMulti("Inner", [leaf], "inner");
		const root = makeMulti("Root", [inner], "root");

		const { catalog } = collectChoiceClosure([root], ["root"]);

		expect(catalog.get("root")).toMatchObject({
			parentId: null,
			path: ["Root"],
		});
		expect(catalog.get("inner")).toMatchObject({
			parentId: "root",
			path: ["Root", "Inner"],
		});
		expect(catalog.get("leaf")).toMatchObject({
			parentId: "inner",
			path: ["Root", "Inner", "Leaf"],
		});
	});

	it("includes the multi choice and all of its descendants from the root", () => {
		const a = makeTemplate("A", "a.md", "a");
		const b = makeTemplate("B", "b.md", "b");
		const root = makeMulti("Root", [a, b], "root");

		const { choiceIds, missingChoiceIds } = collectChoiceClosure(
			[root],
			["root"],
		);

		expect(new Set(choiceIds)).toEqual(new Set(["root", "a", "b"]));
		expect(missingChoiceIds).toEqual([]);
	});

	it("records the root first in traversal order (BFS)", () => {
		const a = makeTemplate("A", "a.md", "a");
		const b = makeTemplate("B", "b.md", "b");
		const root = makeMulti("Root", [a, b], "root");

		const { choiceIds } = collectChoiceClosure([root], ["root"]);

		expect(choiceIds[0]).toBe("root");
	});

	it("does not pull in children when only a leaf is requested as root", () => {
		const a = makeTemplate("A", "a.md", "a");
		const b = makeTemplate("B", "b.md", "b");
		const root = makeMulti("Root", [a, b], "root");

		// Catalog is built from the full tree, but only `a` is the root.
		const { choiceIds } = collectChoiceClosure([root], ["a"]);

		expect(choiceIds).toEqual(["a"]);
	});

	it("follows Macro Choice-command dependencies", () => {
		const target = makeTemplate("Target", "t.md", "target");
		const macro = makeMacro("M", [choiceCommand("target")], "macro");

		const { choiceIds } = collectChoiceClosure(
			[macro, target],
			["macro"],
		);

		expect(new Set(choiceIds)).toEqual(new Set(["macro", "target"]));
	});

	it("follows Conditional then/else Choice-command dependencies in a macro", () => {
		const thenTarget = makeTemplate("Then", "then.md", "thenT");
		const elseTarget = makeTemplate("Else", "else.md", "elseT");
		const macro = makeMacro(
			"M",
			[
				conditionalCommand(
					variableCondition(),
					[choiceCommand("thenT")],
					[choiceCommand("elseT")],
				),
			],
			"macro",
		);

		const { choiceIds } = collectChoiceClosure(
			[macro, thenTarget, elseTarget],
			["macro"],
		);

		expect(new Set(choiceIds)).toEqual(
			new Set(["macro", "thenT", "elseT"]),
		);
	});

	it("collects dependencies of an inline NestedChoice (its children, not its own id)", () => {
		// A nested-choice command embeds a multi-choice inline. The nested
		// choice's own id is NOT a registered catalog choice, but its child id
		// is registered separately and should be reachable.
		const registeredChild = makeTemplate("Child", "c.md", "child");
		const inlineMulti = makeMulti(
			"InlineMulti",
			[registeredChild],
			"inline",
		);
		const macro = makeMacro(
			"M",
			[nestedChoiceCommand(inlineMulti)],
			"macro",
		);

		const { choiceIds, missingChoiceIds } = collectChoiceClosure(
			[macro, registeredChild],
			["macro"],
		);

		expect(new Set(choiceIds)).toEqual(new Set(["macro", "child"]));
		// The inline nested-choice id itself is not enqueued as a dependency.
		expect(missingChoiceIds).toEqual([]);
	});

	it("reports dependency ids absent from the catalog as missing", () => {
		const macro = makeMacro(
			"M",
			[choiceCommand("ghost")],
			"macro",
		);

		const { choiceIds, missingChoiceIds } = collectChoiceClosure(
			[macro],
			["macro"],
		);

		expect(choiceIds).toEqual(["macro"]);
		expect(missingChoiceIds).toEqual(["ghost"]);
	});

	it("reports a missing root id when it is not in the catalog", () => {
		const a = makeTemplate("A", "a.md", "a");

		const { choiceIds, missingChoiceIds } = collectChoiceClosure(
			[a],
			["a", "nope"],
		);

		expect(choiceIds).toEqual(["a"]);
		expect(missingChoiceIds).toEqual(["nope"]);
	});

	it("deduplicates diamond dependencies (a shared target is visited once)", () => {
		const shared = makeTemplate("Shared", "s.md", "shared");
		const m1 = makeMacro("M1", [choiceCommand("shared")], "m1");
		const m2 = makeMacro("M2", [choiceCommand("shared")], "m2");
		const root = makeMulti("Root", [m1, m2], "root");

		const { choiceIds } = collectChoiceClosure(
			[root, shared],
			["root"],
		);

		const sharedCount = choiceIds.filter((id) => id === "shared").length;
		expect(sharedCount).toBe(1);
		expect(new Set(choiceIds)).toEqual(
			new Set(["root", "m1", "m2", "shared"]),
		);
	});

	it("terminates on cyclic Choice-command references", () => {
		const a = makeMacro("A", [choiceCommand("b")], "a");
		const b = makeMacro("B", [choiceCommand("a")], "b");

		const { choiceIds } = collectChoiceClosure([a, b], ["a"]);

		expect(new Set(choiceIds)).toEqual(new Set(["a", "b"]));
	});

	it("deduplicates repeated root ids", () => {
		const a = makeTemplate("A", "a.md", "a");

		const { choiceIds } = collectChoiceClosure([a], ["a", "a"]);

		expect(choiceIds).toEqual(["a"]);
	});

	it("excludes a root id when listed in excludedChoiceIds", () => {
		const a = makeTemplate("A", "a.md", "a");
		const b = makeTemplate("B", "b.md", "b");

		const { choiceIds, missingChoiceIds } = collectChoiceClosure(
			[a, b],
			["a", "b"],
			{ excludedChoiceIds: new Set(["b"]) },
		);

		expect(choiceIds).toEqual(["a"]);
		// Excluded ids are silently skipped, not reported as missing.
		expect(missingChoiceIds).toEqual([]);
	});

	it("excludes a dependency reachable only through a macro", () => {
		const dep = makeTemplate("Dep", "dep.md", "dep");
		const macro = makeMacro("M", [choiceCommand("dep")], "macro");

		const { choiceIds } = collectChoiceClosure(
			[macro, dep],
			["macro"],
			{ excludedChoiceIds: new Set(["dep"]) },
		);

		expect(choiceIds).toEqual(["macro"]);
	});

	it("still includes a multi parent even when one of its children is excluded", () => {
		const kept = makeTemplate("Kept", "kept.md", "kept");
		const dropped = makeTemplate("Dropped", "dropped.md", "dropped");
		const root = makeMulti("Root", [kept, dropped], "root");

		const { choiceIds } = collectChoiceClosure(
			[root],
			["root"],
			{ excludedChoiceIds: new Set(["dropped"]) },
		);

		expect(new Set(choiceIds)).toEqual(new Set(["root", "kept"]));
	});

	it("handles a Multi choice with a non-array `choices` property gracefully", () => {
		const broken = {
			id: "broken",
			name: "Broken",
			type: "Multi",
			command: false,
			collapsed: false,
			choices: undefined,
		} as unknown as IChoice;

		const { choiceIds, catalog } = collectChoiceClosure(
			[broken],
			["broken"],
		);

		expect(choiceIds).toEqual(["broken"]);
		expect(catalog.has("broken")).toBe(true);
	});

	it("ignores macro commands of unrelated types without crashing", () => {
		const waitCommand: ICommand = {
			id: uid("cmd"),
			name: "wait",
			type: CommandType.Wait,
		};
		const macro = makeMacro("M", [waitCommand], "macro");

		const { choiceIds, missingChoiceIds } = collectChoiceClosure(
			[macro],
			["macro"],
		);

		expect(choiceIds).toEqual(["macro"]);
		expect(missingChoiceIds).toEqual([]);
	});
});

// --- collectScriptDependencies ------------------------------------------

describe("collectScriptDependencies", () => {
	function closureFor(
		allChoices: IChoice[],
		roots: string[],
	): {
		catalog: Map<string, ChoiceCatalogEntry>;
		choiceIds: string[];
	} {
		const { catalog, choiceIds } = collectChoiceClosure(allChoices, roots);
		return { catalog, choiceIds };
	}

	it("returns empty sets for no choices", () => {
		const { catalog, choiceIds } = closureFor([], []);
		const result = collectScriptDependencies(catalog, choiceIds);
		expect(result.userScriptPaths.size).toBe(0);
		expect(result.conditionalScriptPaths.size).toBe(0);
	});

	it("collects UserScript paths from a macro", () => {
		const macro = makeMacro(
			"M",
			[userScriptCommand("scripts/foo.js")],
			"macro",
		);
		const { catalog, choiceIds } = closureFor([macro], ["macro"]);

		const result = collectScriptDependencies(catalog, choiceIds);

		expect([...result.userScriptPaths]).toEqual(["scripts/foo.js"]);
		expect(result.conditionalScriptPaths.size).toBe(0);
	});

	it("collects script-mode conditional script paths", () => {
		const macro = makeMacro(
			"M",
			[
				conditionalCommand(
					scriptCondition("scripts/cond.js"),
					[],
					[],
				),
			],
			"macro",
		);
		const { catalog, choiceIds } = closureFor([macro], ["macro"]);

		const result = collectScriptDependencies(catalog, choiceIds);

		expect([...result.conditionalScriptPaths]).toEqual([
			"scripts/cond.js",
		]);
		expect(result.userScriptPaths.size).toBe(0);
	});

	it("does not collect a script path from variable-mode conditionals", () => {
		const macro = makeMacro(
			"M",
			[conditionalCommand(variableCondition(), [], [])],
			"macro",
		);
		const { catalog, choiceIds } = closureFor([macro], ["macro"]);

		const result = collectScriptDependencies(catalog, choiceIds);

		expect(result.conditionalScriptPaths.size).toBe(0);
	});

	it("recurses into conditional then/else branches for UserScripts", () => {
		const macro = makeMacro(
			"M",
			[
				conditionalCommand(
					variableCondition(),
					[userScriptCommand("scripts/then.js")],
					[userScriptCommand("scripts/else.js")],
				),
			],
			"macro",
		);
		const { catalog, choiceIds } = closureFor([macro], ["macro"]);

		const result = collectScriptDependencies(catalog, choiceIds);

		expect(result.userScriptPaths).toEqual(
			new Set(["scripts/then.js", "scripts/else.js"]),
		);
	});

	it("deduplicates identical script paths", () => {
		const macro = makeMacro(
			"M",
			[
				userScriptCommand("scripts/dup.js"),
				userScriptCommand("scripts/dup.js"),
			],
			"macro",
		);
		const { catalog, choiceIds } = closureFor([macro], ["macro"]);

		const result = collectScriptDependencies(catalog, choiceIds);

		expect([...result.userScriptPaths]).toEqual(["scripts/dup.js"]);
	});

	it("ignores UserScript commands with an empty path", () => {
		const macro = makeMacro(
			"M",
			[userScriptCommand("")],
			"macro",
		);
		const { catalog, choiceIds } = closureFor([macro], ["macro"]);

		const result = collectScriptDependencies(catalog, choiceIds);

		expect(result.userScriptPaths.size).toBe(0);
	});

	it("descends into multi-choice children to find scripts", () => {
		const innerMacro = makeMacro(
			"Inner",
			[userScriptCommand("scripts/inner.js")],
			"innerMacro",
		);
		const root = makeMulti("Root", [innerMacro], "root");
		const { catalog, choiceIds } = closureFor([root], ["root"]);

		const result = collectScriptDependencies(catalog, choiceIds);

		expect([...result.userScriptPaths]).toEqual(["scripts/inner.js"]);
	});

	it("collects scripts from an inline nested choice not present in the catalog", () => {
		// The inline nested choice's id is not in the catalog, so
		// shouldIncludeChoice returns true and it is always traversed.
		const inlineMacro = makeMacro(
			"Inline",
			[userScriptCommand("scripts/nested.js")],
			"inlineNotInCatalog",
		);
		const macro = makeMacro(
			"M",
			[nestedChoiceCommand(inlineMacro)],
			"macro",
		);
		// Build catalog from `macro` only; the inline macro id is not registered.
		const { catalog } = collectChoiceClosure([macro], ["macro"]);

		const result = collectScriptDependencies(catalog, ["macro"]);

		expect([...result.userScriptPaths]).toEqual(["scripts/nested.js"]);
	});

	it("does not follow a Choice command whose target is outside the included set", () => {
		// `target` exists in the catalog but is NOT in the included choiceIds,
		// so its scripts must not be collected.
		const target = makeMacro(
			"Target",
			[userScriptCommand("scripts/target.js")],
			"target",
		);
		const macro = makeMacro("M", [choiceCommand("target")], "macro");
		const { catalog } = collectChoiceClosure([macro, target], ["macro"]);

		// Intentionally pass only the macro id as included.
		const result = collectScriptDependencies(catalog, ["macro"]);

		expect(result.userScriptPaths.size).toBe(0);
	});

	it("follows a Choice command whose target IS in the included set", () => {
		const target = makeMacro(
			"Target",
			[userScriptCommand("scripts/target.js")],
			"target",
		);
		const macro = makeMacro("M", [choiceCommand("target")], "macro");
		const { catalog, choiceIds } = collectChoiceClosure(
			[macro, target],
			["macro"],
		);

		const result = collectScriptDependencies(catalog, choiceIds);

		expect([...result.userScriptPaths]).toEqual(["scripts/target.js"]);
	});
});

// --- collectFileDependencies --------------------------------------------

describe("collectFileDependencies", () => {
	function closureFor(allChoices: IChoice[], roots: string[]) {
		return collectChoiceClosure(allChoices, roots);
	}

	const captureWithTemplate = (
		name: string,
		template: string,
		id?: string,
	): ICaptureChoice =>
		makeCapture(
			name,
			{ enabled: true, createWithTemplate: true, template },
			id,
		);

	it("returns empty sets for no choices", () => {
		const { catalog, choiceIds } = closureFor([], []);
		const result = collectFileDependencies(catalog, choiceIds);
		expect(result.templatePaths.size).toBe(0);
		expect(result.captureTemplatePaths.size).toBe(0);
	});

	it("collects template paths from template choices", () => {
		const tmpl = makeTemplate("T", "templates/note.md", "t");
		const { catalog, choiceIds } = closureFor([tmpl], ["t"]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect([...result.templatePaths]).toEqual(["templates/note.md"]);
		expect(result.captureTemplatePaths.size).toBe(0);
	});

	it("ignores template choices with an empty templatePath", () => {
		const tmpl = makeTemplate("T", "", "t");
		const { catalog, choiceIds } = closureFor([tmpl], ["t"]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect(result.templatePaths.size).toBe(0);
	});

	it("collects capture templates when createFileIfItDoesntExist is fully enabled", () => {
		const cap = captureWithTemplate("C", "templates/cap.md", "c");
		const { catalog, choiceIds } = closureFor([cap], ["c"]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect([...result.captureTemplatePaths]).toEqual([
			"templates/cap.md",
		]);
		expect(result.templatePaths.size).toBe(0);
	});

	it("does not collect a capture template when createFileIfItDoesntExist is disabled", () => {
		const cap = makeCapture("C", {
			enabled: false,
			createWithTemplate: true,
			template: "templates/cap.md",
		});
		const { catalog, choiceIds } = closureFor([cap], [cap.id]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect(result.captureTemplatePaths.size).toBe(0);
	});

	it("does not collect a capture template when createWithTemplate is false", () => {
		const cap = makeCapture("C", {
			enabled: true,
			createWithTemplate: false,
			template: "templates/cap.md",
		});
		const { catalog, choiceIds } = closureFor([cap], [cap.id]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect(result.captureTemplatePaths.size).toBe(0);
	});

	it("does not collect a capture template when the template path is empty", () => {
		const cap = makeCapture("C", {
			enabled: true,
			createWithTemplate: true,
			template: "",
		});
		const { catalog, choiceIds } = closureFor([cap], [cap.id]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect(result.captureTemplatePaths.size).toBe(0);
	});

	it("handles a capture choice without a createFileIfItDoesntExist object", () => {
		const cap = makeCapture("C", undefined);
		const { catalog, choiceIds } = closureFor([cap], [cap.id]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect(result.captureTemplatePaths.size).toBe(0);
	});

	it("descends into multi-choice children to collect file dependencies", () => {
		const tmpl = makeTemplate("T", "templates/child.md", "t");
		const cap = captureWithTemplate("C", "templates/cap.md", "c");
		const root = makeMulti("Root", [tmpl, cap], "root");
		const { catalog, choiceIds } = closureFor([root], ["root"]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect([...result.templatePaths]).toEqual(["templates/child.md"]);
		expect([...result.captureTemplatePaths]).toEqual([
			"templates/cap.md",
		]);
	});

	it("collects template dependencies reached through macro Choice commands", () => {
		const tmpl = makeTemplate("T", "templates/target.md", "target");
		const macro = makeMacro("M", [choiceCommand("target")], "macro");
		const { catalog, choiceIds } = closureFor([macro, tmpl], ["macro"]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect([...result.templatePaths]).toEqual(["templates/target.md"]);
	});

	it("recurses into conditional then/else branches via nested choices", () => {
		const inlineTemplate = makeTemplate(
			"Inline",
			"templates/inline.md",
			"inlineTmpl",
		);
		const macro = makeMacro(
			"M",
			[
				conditionalCommand(
					variableCondition(),
					[nestedChoiceCommand(inlineTemplate)],
					[],
				),
			],
			"macro",
		);
		// Inline template id is not registered in the catalog, so it is always
		// traversed inside the conditional branch.
		const { catalog } = collectChoiceClosure([macro], ["macro"]);

		const result = collectFileDependencies(catalog, ["macro"]);

		expect([...result.templatePaths]).toEqual(["templates/inline.md"]);
	});

	it("does not follow a Choice command target outside the included set", () => {
		const tmpl = makeTemplate("T", "templates/target.md", "target");
		const macro = makeMacro("M", [choiceCommand("target")], "macro");
		const { catalog } = collectChoiceClosure([macro, tmpl], ["macro"]);

		const result = collectFileDependencies(catalog, ["macro"]);

		expect(result.templatePaths.size).toBe(0);
	});

	it("deduplicates a shared template reached through multiple choices", () => {
		const shared = makeTemplate("Shared", "templates/shared.md", "shared");
		const m1 = makeMacro("M1", [choiceCommand("shared")], "m1");
		const m2 = makeMacro("M2", [choiceCommand("shared")], "m2");
		const root = makeMulti("Root", [m1, m2], "root");
		const { catalog, choiceIds } = closureFor([root, shared], ["root"]);

		const result = collectFileDependencies(catalog, choiceIds);

		expect([...result.templatePaths]).toEqual(["templates/shared.md"]);
	});
});
