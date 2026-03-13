import { describe, expect, it } from "vitest";
import migration from "./incrementFileNameSettingMoveToDefaultBehavior";

describe("incrementFileNameSettingMoveToDefaultBehavior migration", () => {
	it("migrates legacy incrementFileName choices to the new behavior model", async () => {
		const plugin = {
			settings: {
				choices: [
					{
						id: "template-choice",
						name: "Template",
						type: "Template",
						incrementFileName: true,
					},
				],
				macros: [],
			},
		} as any;

		await migration.migrate(plugin);

		expect(plugin.settings.choices[0]).toMatchObject({
			fileExistsBehavior: { kind: "apply", mode: "increment" },
		});
		expect(plugin.settings.choices[0].incrementFileName).toBeUndefined();
		expect(plugin.settings.choices[0].fileExistsMode).toBeUndefined();
		expect(plugin.settings.choices[0].setFileExistsBehavior).toBeUndefined();
	});

	it("migrates split legacy settings on template choices", async () => {
		const plugin = {
			settings: {
				choices: [
					{
						id: "prompt-choice",
						name: "Prompt Template",
						type: "Template",
						setFileExistsBehavior: false,
						fileExistsMode: "Append to the bottom of the file",
					},
					{
						id: "apply-choice",
						name: "Apply Template",
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
			fileExistsBehavior: { kind: "prompt" },
		});
		expect(plugin.settings.choices[1]).toMatchObject({
			fileExistsBehavior: { kind: "apply", mode: "duplicateSuffix" },
		});
	});

	it("migrates nested macro command template choices", async () => {
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
									setFileExistsBehavior: true,
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
			fileExistsBehavior: { kind: "apply", mode: "overwrite" },
		});
		expect(
			plugin.settings.macros[0].commands[0].choice.fileExistsMode,
		).toBeUndefined();
		expect(
			plugin.settings.macros[0].commands[0].choice.setFileExistsBehavior,
		).toBeUndefined();
	});
});
