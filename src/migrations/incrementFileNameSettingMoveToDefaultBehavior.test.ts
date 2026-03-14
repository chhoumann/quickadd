import { describe, expect, it } from "vitest";
import migration from "./incrementFileNameSettingMoveToDefaultBehavior";

describe("incrementFileNameSettingMoveToDefaultBehavior migration", () => {
	it("migrates legacy incrementFileName choices to the old split behavior model", async () => {
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
			setFileExistsBehavior: true,
			fileExistsMode: "Increment the file name",
		});
		expect(plugin.settings.choices[0].incrementFileName).toBeUndefined();
	});

	it("leaves already-split legacy settings unchanged", async () => {
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
			setFileExistsBehavior: false,
			fileExistsMode: "Append to the bottom of the file",
		});
		expect(plugin.settings.choices[1]).toMatchObject({
			setFileExistsBehavior: true,
			fileExistsMode: "Append duplicate suffix",
		});
		expect(plugin.settings.choices[0].fileExistsBehavior).toBeUndefined();
		expect(plugin.settings.choices[1].fileExistsBehavior).toBeUndefined();
	});

	it("migrates nested macro command template choices to the old split behavior model", async () => {
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
									incrementFileName: true,
								},
							},
						],
					},
				],
			},
		} as any;

		await migration.migrate(plugin);

		expect(plugin.settings.macros[0].commands[0].choice).toMatchObject({
			setFileExistsBehavior: true,
			fileExistsMode: "Increment the file name",
		});
		expect(plugin.settings.macros[0].commands[0].choice.incrementFileName).toBeUndefined();
	});
});
