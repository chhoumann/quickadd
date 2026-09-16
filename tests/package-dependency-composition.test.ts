import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import { buildPackage } from "../src/services/packageExportService";
import { MacroChoice } from "../src/types/choices/MacroChoice";
import { MultiChoice } from "../src/types/choices/MultiChoice";
import { TemplateChoice } from "../src/types/choices/TemplateChoice";
import { ChoiceCommand } from "../src/types/macros/ChoiceCommand";
import { UserScript } from "../src/types/macros/UserScript";
import { collectChoiceClosure, collectFileDependencies, collectScriptDependencies } from "../src/utils/packageTraversal";

describe("Package dependency composition", () => {
	it("exports choices reached through ChoiceCommand in dependency order", async () => {
		const parent = new MacroChoice("Parent");
		const child = new MacroChoice("Child");
		parent.macro.commands.push(new ChoiceCommand("Run child", child.id));
		const app = { vault: { adapter: { exists: async () => false } } } as unknown as App;
		const { pkg, missingChoiceIds } = await buildPackage(app, {
			choices: [parent, child], rootChoiceIds: [parent.id], quickAddVersion: "2.5.0",
		});
		expect(pkg.choices.map(({ choice }) => choice.id)).toEqual([parent.id, child.id]);
		expect(missingChoiceIds).toEqual([]);
	});

	it("does not collect template or script assets of excluded multi children", () => {
		const group = new MultiChoice("Group");
		const children = ["kept", "excluded"].map((name) => {
			const template = new TemplateChoice(name);
			template.templatePath = `Templates/${name}.md`;
			const macro = new MacroChoice(name);
			macro.macro.commands.push(new UserScript(name, `Scripts/${name}.js`));
			return { template, macro };
		});
		group.choices.push(...children.flatMap(({ template, macro }) => [template, macro]));
		const { catalog, choiceIds } = collectChoiceClosure([group], [group.id], {
			excludedChoiceIds: new Set([children[1].template.id, children[1].macro.id]),
		});
		expect(choiceIds).toEqual([group.id, children[0].template.id, children[0].macro.id]);
		const files = collectFileDependencies(catalog, choiceIds);
		const scripts = collectScriptDependencies(catalog, choiceIds);
		expect([...files.templatePaths]).toEqual(["Templates/kept.md"]);
		expect([...scripts.userScriptPaths]).toEqual(["Scripts/kept.js"]);
	});
});
