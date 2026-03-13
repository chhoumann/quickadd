import { describe, expect, it } from "vitest";
import migration from "./consolidateFileExistsBehavior";

describe("consolidateFileExistsBehavior migration", () => {
	it("converts split legacy template choice state even when the old migration already ran", async () => {
		const plugin = {
			settings: {
				choices: [
					{
						id: "template-choice",
						name: "Template",
						type: "Template",
						setFileExistsBehavior: true,
						fileExistsMode: "Append duplicate suffix",
					},
				],
				macros: [],
			},
		} as any;

		await migration.migrate(plugin);

		expect(plugin.settings.choices[0]).toMatchObject({
			fileExistsBehavior: { kind: "apply", mode: "duplicateSuffix" },
		});
		expect(plugin.settings.choices[0].fileExistsMode).toBeUndefined();
		expect(plugin.settings.choices[0].setFileExistsBehavior).toBeUndefined();
	});

	it("normalizes nested macro command template choices", async () => {
		const plugin = {
			settings: {
				choices: [],
				macros: [
					{
						id: "macro-1",
						name: "Macro",
						commands: [
							{
								id: "command-1",
								type: "Choice",
								choice: {
									id: "template-choice",
									name: "Template",
									type: "Template",
									setFileExistsBehavior: false,
									fileExistsMode: "Overwrite the file",
								},
							},
						],
					},
				],
			},
		} as any;

		await migration.migrate(plugin);

		expect(plugin.settings.macros[0].commands[0].choice).toMatchObject({
			fileExistsBehavior: { kind: "prompt" },
		});
	});
});
