import { describe, expect, it } from "vitest";
import migration from "./consolidateFileExistsBehavior";
import { legacyMacro, migrationPlugin, nestedChoice } from "../../tests/helpers/utilities/migrationFixtures";

function template(overrides: Record<string, unknown> = {}) {
	return {
		id: "template-choice",
		name: "Template",
		type: "Template",
		setFileExistsBehavior: true,
		fileExistsMode: "Append duplicate suffix",
		...overrides,
	};
}

function expectMigrated(choice: { fileExistsMode?: unknown; setFileExistsBehavior?: unknown }, behavior: object) {
	expect(choice).toMatchObject({ fileExistsBehavior: behavior });
	expect(choice.fileExistsMode).toBeUndefined();
	expect(choice.setFileExistsBehavior).toBeUndefined();
}

const duplicateSuffix = { kind: "apply", mode: "duplicateSuffix" };

describe("consolidateFileExistsBehavior migration", () => {
	it("converts split legacy template choice state even when the old migration already ran", async () => {
		const plugin = migrationPlugin({ choices: [template()], macros: [] });
		await migration.migrate(plugin);
		expectMigrated(plugin.settings.choices[0], duplicateSuffix);
	});

	it("prefers explicit legacy fileExistsMode over incrementFileName when both are present", async () => {
		const plugin = migrationPlugin({ choices: [template({ incrementFileName: true })], macros: [] });
		await migration.migrate(plugin);
		expect(plugin.settings.choices[0]).toMatchObject({ fileExistsBehavior: duplicateSuffix });
	});

	it("normalizes template choices nested inside Macro choice commands", async () => {
		const plugin = migrationPlugin({
			choices: [{
				id: "macro-choice",
				name: "Macro Choice",
				type: "Macro",
				macro: legacyMacro([nestedChoice(template())]),
			}],
			macros: [],
		});
		await migration.migrate(plugin);
		expectMigrated(plugin.settings.choices[0].macro.commands[0].choice, duplicateSuffix);
	});

	it("normalizes nested macro command template choices in legacy macros", async () => {
		const plugin = migrationPlugin({
			choices: [],
			macros: [legacyMacro([{
				id: "command-1",
				type: "Choice",
				choice: template({ setFileExistsBehavior: false, fileExistsMode: "Overwrite the file" }),
			}])],
		});
		await migration.migrate(plugin);
		expectMigrated(plugin.settings.macros[0].commands[0].choice, { kind: "prompt" });
	});

	it("normalizes template choices nested in conditional macro branches", async () => {
		const plugin = migrationPlugin({
			choices: [],
			macros: [legacyMacro([{
				type: "Conditional",
				thenCommands: [nestedChoice(template({ id: "template-then", name: "Then Template" }))],
				elseCommands: [nestedChoice(template({
					id: "template-else",
					name: "Else Template",
					setFileExistsBehavior: false,
					fileExistsMode: "Overwrite the file",
				}))],
			}])],
		});
		await migration.migrate(plugin);
		const conditional = plugin.settings.macros[0].commands[0];
		expectMigrated(conditional.thenCommands[0].choice, duplicateSuffix);
		expectMigrated(conditional.elseCommands[0].choice, { kind: "prompt" });
	});

	it("walks past malformed persisted collections without replacing them", async () => {
		const choices = { invalid: true };
		const macros = "invalid";
		const plugin = migrationPlugin({ choices, macros });
		await migration.migrate(plugin);
		expect(plugin.settings.choices).toBe(choices);
		expect(plugin.settings.macros).toBe(macros);
	});
});
