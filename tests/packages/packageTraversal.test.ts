import { describe, expect, it } from "vitest";
import { collectChoiceClosure, collectScriptDependencies } from "../../src/utils/packageTraversal";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { ChoiceCommand } from "../../src/types/macros/ChoiceCommand";
import { UserScript } from "../../src/types/macros/UserScript";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { ConditionalCommand } from "../../src/types/macros/Conditional/ConditionalCommand";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";

describe("packageTraversal", () => {
	it("collects dependent choice ids referenced by ChoiceCommand", () => {
		const macroA = new MacroChoice("Macro A");
		const macroB = new MacroChoice("Macro B");
		macroA.macro.commands.push(new ChoiceCommand("Run B", macroB.id));

		const closure = collectChoiceClosure([macroA, macroB], [macroA.id]);

		expect(closure.choiceIds).toEqual([macroA.id, macroB.id]);
		expect(closure.missingChoiceIds).toHaveLength(0);
	});

	it("includes multi choice children with path hints", () => {
		const group = new MultiChoice("Group");
		const template = new TemplateChoice("Child Template");
		group.choices.push(template);

		const closure = collectChoiceClosure([group], [group.id]);
		const coveredIds = new Set(closure.choiceIds);

		expect(coveredIds.has(group.id)).toBe(true);
		expect(coveredIds.has(template.id)).toBe(true);

		const entry = closure.catalog.get(template.id);
		expect(entry?.path).toEqual([group.name, template.name]);
	});

	it("records missing dependencies when the target choice is absent", () => {
		const macro = new MacroChoice("Broken macro");
		// Reference a choice id that does not exist in the catalog
		macro.macro.commands.push(new ChoiceCommand("Missing", "non-existent-id"));

		const closure = collectChoiceClosure([macro], [macro.id]);
		expect(closure.missingChoiceIds).toContain("non-existent-id");
	});

	it("collects user script paths from macros", () => {
		const macro = new MacroChoice("Script runner");
		macro.macro.commands.push(new UserScript("Run script", "Scripts/doThing.js"));

		const closure = collectChoiceClosure([macro], [macro.id]);
		const scripts = collectScriptDependencies(closure.catalog, closure.choiceIds);

		expect([...scripts.userScriptPaths]).toEqual(["Scripts/doThing.js"]);
	});

	it("collects conditional script paths and recurses into branches", () => {
		const macro = new MacroChoice("Conditional runner");
		const conditional = new ConditionalCommand();
		conditional.condition = {
			mode: "script",
			scriptPath: "Scripts/check.js",
			exportName: "evaluate",
		};

		const branchScript = new UserScript("Branch script", "Scripts/branch.js");
		conditional.thenCommands.push(branchScript);
		macro.macro.commands.push(conditional);

		const closure = collectChoiceClosure([macro], [macro.id]);
		const scripts = collectScriptDependencies(closure.catalog, closure.choiceIds);

		expect([...scripts.conditionalScriptPaths]).toEqual(["Scripts/check.js"]);
		expect([...scripts.userScriptPaths]).toEqual(["Scripts/branch.js"]);
	});

	it("collects scripts from transitive choice dependencies", () => {
		const parent = new MacroChoice("Parent");
		const child = new MacroChoice("Child");

		child.macro.commands.push(new UserScript("Child script", "Scripts/child.js"));
		parent.macro.commands.push(new ChoiceCommand("Run child", child.id));

		const closure = collectChoiceClosure([parent, child], [parent.id]);
	const scripts = collectScriptDependencies(closure.catalog, closure.choiceIds);

	expect([...scripts.userScriptPaths]).toEqual(["Scripts/child.js"]);
	});

	it("collects dependencies from nested choice commands", () => {
		const nested = new MacroChoice("Nested Macro");
		const target = new MacroChoice("Target Macro");
		nested.macro.commands.push(new ChoiceCommand("Run target", target.id));

		const outer = new MacroChoice("Outer Macro");
		outer.macro.commands.push(new NestedChoiceCommand(nested));

		const closure = collectChoiceClosure([outer, nested, target], [outer.id]);
		const coveredIds = new Set(closure.choiceIds);
		expect(coveredIds.has(nested.id)).toBe(true);
		expect(coveredIds.has(target.id)).toBe(true);
		expect(closure.missingChoiceIds).toHaveLength(0);
	});
});
