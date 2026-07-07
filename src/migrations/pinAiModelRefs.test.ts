import { beforeEach, describe, expect, it } from "vitest";
import type QuickAdd from "src/main";
import type { AIProvider } from "src/ai/Provider";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import { CommandType } from "src/types/macros/CommandType";
import type IChoice from "src/types/choices/IChoice";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import pinAiModelRefs from "./pinAiModelRefs";

const mockPlugin = {} as unknown as QuickAdd;

function provider(overrides: Partial<AIProvider>): AIProvider {
	return {
		name: "Provider",
		endpoint: "https://example.test/v1",
		apiKey: "",
		models: [],
		modelSource: "providerApi",
		...overrides,
	};
}

function aiCommand(model: string): IAIAssistantCommand {
	return {
		id: `cmd-${model}`,
		name: `AI: ${model}`,
		type: CommandType.AIAssistant,
		model,
		systemPrompt: "",
		outputVariableName: "output",
		promptTemplate: { enable: false, name: "" },
		modelParameters: {},
	};
}

function macroChoiceWith(commands: IAIAssistantCommand[]): IChoice {
	return {
		id: "macro-1",
		name: "Macro",
		type: "Macro",
		command: false,
		macro: { name: "Macro", id: "m1", commands },
	} as unknown as IChoice;
}

function storedCommands(): IAIAssistantCommand[] {
	const choice = settingsStore.getState().choices[0] as unknown as {
		macro: { commands: IAIAssistantCommand[] };
	};
	return choice.macro.commands;
}

beforeEach(() => {
	settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
});

describe("pinAiModelRefs migration", () => {
	it("assigns stable ids to providers that lack one", async () => {
		settingsStore.setState({
			ai: {
				...settingsStore.getState().ai,
				providers: [
					provider({ name: "OpenAI" }),
					provider({ name: "My Proxy" }),
				],
			},
		});

		await pinAiModelRefs.migrate(mockPlugin);

		expect(
			settingsStore.getState().ai.providers.map((p) => p.id),
		).toEqual(["openai", "my-proxy"]);
	});

	it("pins each command to the provider first-match resolves to today", async () => {
		settingsStore.setState({
			choices: [macroChoiceWith([aiCommand("gpt-4o")])],
			ai: {
				...settingsStore.getState().ai,
				providers: [
					// The proxy comes FIRST: pre-#1495 resolution routed gpt-4o to
					// it, so the pin must record the proxy — not the official one.
					provider({
						name: "Proxy",
						models: [{ name: "gpt-4o", maxTokens: 1 }],
					}),
					provider({
						name: "OpenAI",
						models: [{ name: "gpt-4o", maxTokens: 2 }],
					}),
				],
			},
		});

		await pinAiModelRefs.migrate(mockPlugin);

		expect(storedCommands()[0].modelRef).toEqual({
			providerId: "proxy",
			name: "gpt-4o",
		});
		// The legacy string stays untouched for downgrades/imports.
		expect(storedCommands()[0].model).toBe("gpt-4o");
	});

	it("leaves 'Ask me' and unresolvable models unpinned", async () => {
		settingsStore.setState({
			choices: [
				macroChoiceWith([aiCommand("Ask me"), aiCommand("deleted-model")]),
			],
			ai: {
				...settingsStore.getState().ai,
				providers: [
					provider({
						name: "OpenAI",
						models: [{ name: "gpt-4o", maxTokens: 1 }],
					}),
				],
			},
		});

		await pinAiModelRefs.migrate(mockPlugin);

		expect(storedCommands()[0].modelRef).toBeUndefined();
		expect(storedCommands()[1].modelRef).toBeUndefined();
		expect(storedCommands()[1].model).toBe("deleted-model");
	});

	it("pins the default model and preserves an existing ref on re-run", async () => {
		settingsStore.setState({
			ai: {
				...settingsStore.getState().ai,
				defaultModel: "gpt-4o",
				providers: [
					provider({
						name: "OpenAI",
						models: [{ name: "gpt-4o", maxTokens: 1 }],
					}),
					provider({
						id: "proxy",
						name: "Proxy",
						models: [{ name: "gpt-4o", maxTokens: 1 }],
					}),
				],
			},
		});

		await pinAiModelRefs.migrate(mockPlugin);
		expect(settingsStore.getState().ai.defaultModelRef).toEqual({
			providerId: "openai",
			name: "gpt-4o",
		});

		// A second run (e.g. after a partial-failure retry) must not re-pin.
		settingsStore.setState({
			ai: {
				...settingsStore.getState().ai,
				defaultModelRef: { providerId: "proxy", name: "gpt-4o" },
			},
		});
		await pinAiModelRefs.migrate(mockPlugin);
		expect(settingsStore.getState().ai.defaultModelRef).toEqual({
			providerId: "proxy",
			name: "gpt-4o",
		});
	});

	it("re-pins a STALE ref (name drifted from the legacy string) from the string", async () => {
		const command = aiCommand("gpt-4o");
		// An older QuickAdd rewrote the visible model string while this pinned
		// ref survived in data.json.
		command.modelRef = { providerId: "proxy", name: "o3" };

		settingsStore.setState({
			choices: [macroChoiceWith([command])],
			ai: {
				...settingsStore.getState().ai,
				providers: [
					provider({
						name: "OpenAI",
						models: [{ name: "gpt-4o", maxTokens: 1 }],
					}),
				],
			},
		});

		await pinAiModelRefs.migrate(mockPlugin);

		expect(storedCommands()[0].modelRef).toEqual({
			providerId: "openai",
			name: "gpt-4o",
		});
	});

	it("re-pins a ref whose provider does not exist in this vault (cross-vault import shape)", async () => {
		const command = aiCommand("gpt-4o");
		// Name matches, but "their-proxy" is the EXPORTING vault's provider id.
		command.modelRef = { providerId: "their-proxy", name: "gpt-4o" };

		settingsStore.setState({
			choices: [macroChoiceWith([command])],
			ai: {
				...settingsStore.getState().ai,
				providers: [
					provider({
						name: "OpenAI",
						models: [{ name: "gpt-4o", maxTokens: 1 }],
					}),
				],
			},
		});

		await pinAiModelRefs.migrate(mockPlugin);

		expect(storedCommands()[0].modelRef).toEqual({
			providerId: "openai",
			name: "gpt-4o",
		});
	});

	it("re-pins a ref whose provider exists but no longer serves the model", async () => {
		const command = aiCommand("gpt-4o");
		command.modelRef = { providerId: "openai", name: "gpt-4o" };

		settingsStore.setState({
			choices: [macroChoiceWith([command])],
			ai: {
				...settingsStore.getState().ai,
				providers: [
					provider({ id: "openai", name: "OpenAI", models: [] }),
					provider({
						id: "proxy",
						name: "Proxy",
						models: [{ name: "gpt-4o", maxTokens: 1 }],
					}),
				],
			},
		});

		await pinAiModelRefs.migrate(mockPlugin);

		expect(storedCommands()[0].modelRef).toEqual({
			providerId: "proxy",
			name: "gpt-4o",
		});
	});

	it("reaches AI commands nested in Multi folders", async () => {
		const nested = {
			id: "multi-1",
			name: "Folder",
			type: "Multi",
			command: false,
			choices: [macroChoiceWith([aiCommand("gpt-4o")])],
		} as unknown as IChoice;

		settingsStore.setState({
			choices: [nested],
			ai: {
				...settingsStore.getState().ai,
				providers: [
					provider({
						name: "OpenAI",
						models: [{ name: "gpt-4o", maxTokens: 1 }],
					}),
				],
			},
		});

		await pinAiModelRefs.migrate(mockPlugin);

		const multi = settingsStore.getState().choices[0] as unknown as {
			choices: Array<{ macro: { commands: IAIAssistantCommand[] } }>;
		};
		expect(multi.choices[0].macro.commands[0].modelRef).toEqual({
			providerId: "openai",
			name: "gpt-4o",
		});
	});
});
