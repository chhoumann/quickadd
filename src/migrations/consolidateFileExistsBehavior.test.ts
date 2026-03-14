import { CommandType } from "../types/macros/CommandType";
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

	it("prefers explicit legacy fileExistsMode over incrementFileName when both are present", async () => {
		const plugin = {
			settings: {
				choices: [
					{
						id: "template-choice",
						name: "Template",
						type: "Template",
						incrementFileName: true,
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
	});

	it("normalizes template choices nested inside Macro choice commands", async () => {
		const plugin = {
			settings: {
				choices: [
					{
						id: "macro-choice",
						name: "Macro Choice",
						type: "Macro",
						macro: {
							id: "macro-1",
							name: "Macro",
							commands: [
								{
									type: CommandType.NestedChoice,
									choice: {
										id: "template-choice",
										name: "Template",
										type: "Template",
										setFileExistsBehavior: true,
										fileExistsMode: "Append duplicate suffix",
									},
								},
							],
						},
					},
				],
				macros: [],
			},
		} as any;

		await migration.migrate(plugin);

		expect(
			plugin.settings.choices[0].macro.commands[0].choice,
		).toMatchObject({
			fileExistsBehavior: { kind: "apply", mode: "duplicateSuffix" },
		});
		expect(
			plugin.settings.choices[0].macro.commands[0].choice.fileExistsMode,
		).toBeUndefined();
		expect(
			plugin.settings.choices[0].macro.commands[0].choice.setFileExistsBehavior,
		).toBeUndefined();
	});

	it("normalizes nested macro command template choices in legacy macros", async () => {
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
		expect(
			plugin.settings.macros[0].commands[0].choice.fileExistsMode,
		).toBeUndefined();
		expect(
			plugin.settings.macros[0].commands[0].choice.setFileExistsBehavior,
		).toBeUndefined();
	});

	it("normalizes template choices nested in conditional macro branches", async () => {
		const plugin = {
			settings: {
				choices: [],
				macros: [
					{
						id: "macro-1",
						name: "Macro",
						commands: [
							{
								type: CommandType.Conditional,
								thenCommands: [
									{
										type: CommandType.NestedChoice,
										choice: {
											id: "template-then",
											name: "Then Template",
											type: "Template",
											setFileExistsBehavior: true,
											fileExistsMode: "Append duplicate suffix",
										},
									},
								],
								elseCommands: [
									{
										type: CommandType.NestedChoice,
										choice: {
											id: "template-else",
											name: "Else Template",
											type: "Template",
											setFileExistsBehavior: false,
											fileExistsMode: "Overwrite the file",
										},
									},
								],
							},
						],
					},
				],
			},
		} as any;

		await migration.migrate(plugin);

		expect(
			plugin.settings.macros[0].commands[0].thenCommands[0].choice,
		).toMatchObject({
			fileExistsBehavior: { kind: "apply", mode: "duplicateSuffix" },
		});
		expect(
			plugin.settings.macros[0].commands[0].thenCommands[0].choice
				.fileExistsMode,
		).toBeUndefined();
		expect(
			plugin.settings.macros[0].commands[0].thenCommands[0].choice
				.setFileExistsBehavior,
		).toBeUndefined();
		expect(
			plugin.settings.macros[0].commands[0].elseCommands[0].choice,
		).toMatchObject({
			fileExistsBehavior: { kind: "prompt" },
		});
		expect(
			plugin.settings.macros[0].commands[0].elseCommands[0].choice
				.fileExistsMode,
		).toBeUndefined();
		expect(
			plugin.settings.macros[0].commands[0].elseCommands[0].choice
				.setFileExistsBehavior,
		).toBeUndefined();
	});

	it("treats malformed persisted choice and macro collections as empty arrays", async () => {
		const plugin = {
			settings: {
				choices: { invalid: true },
				macros: "invalid",
			},
		} as any;

		await migration.migrate(plugin);

		expect(plugin.settings.choices).toEqual([]);
		expect(plugin.settings.macros).toEqual([]);
	});
});
