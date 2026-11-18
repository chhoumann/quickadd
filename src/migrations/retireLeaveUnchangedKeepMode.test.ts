import { describe, expect, it } from "vitest";
import migration from "./retireLeaveUnchangedKeepMode";
import { normalizeImportedChoice } from "../services/packageChoiceImport";
import type IChoice from "../types/choices/IChoice";
import { migrationPlugin } from "../../tests/helpers/utilities/migrationFixtures";

function template(mode: string, openFile: boolean) {
	return {
		id: `template-${mode}-${openFile}`,
		name: "Daily",
		type: "Template",
		openFile,
		fileExistsBehavior: { kind: "apply", mode },
	};
}

describe("retireLeaveUnchangedKeepMode migration", () => {
	it.each([
		{ openFile: true, mode: "doNothing" },
		{ openFile: false, mode: "leaveClosed" },
	])("moves leaveUnchanged with Open=$openFile to $mode, which opens the kept note the same way", async ({ openFile, mode }) => {
		const plugin = migrationPlugin({ choices: [template("leaveUnchanged", openFile)], macros: [] });
		await migration.migrate(plugin);
		expect(plugin.settings.choices[0].fileExistsBehavior).toEqual({ kind: "apply", mode });
	});

	it("leaves the current keep modes alone", async () => {
		const plugin = migrationPlugin({
			choices: [template("leaveClosed", true), template("doNothing", false)],
			macros: [],
		});
		await migration.migrate(plugin);
		expect(plugin.settings.choices.map((choice: { fileExistsBehavior: unknown }) => choice.fileExistsBehavior)).toEqual([
			{ kind: "apply", mode: "leaveClosed" },
			{ kind: "apply", mode: "doNothing" },
		]);
	});

	it("maps leaveUnchanged in a package exported before the migration", () => {
		const choice = template("leaveUnchanged", true) as unknown as IChoice;
		normalizeImportedChoice(choice);
		expect((choice as unknown as { fileExistsBehavior: unknown }).fileExistsBehavior).toEqual({ kind: "apply", mode: "doNothing" });
	});
});
