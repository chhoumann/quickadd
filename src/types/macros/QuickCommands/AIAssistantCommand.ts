import type { Models_And_Ask_Me } from "src/ai/models";
import { Command } from "../Command";
import { CommandType } from "../CommandType";
import type { IAIAssistantCommand } from "./IAIAssistantCommand";
import { settingsStore } from "src/settingsStore";
import { DEFAULT_FREQUENCY_PENALTY, DEFAULT_PRESENCE_PENALTY, DEFAULT_TEMPERATURE, DEFAULT_TOP_P, OpenAIModelParameters } from "src/ai/OpenAIModelParameters";

export class AIAssistantCommand extends Command implements IAIAssistantCommand {
	id: string;
	name: string;
	type: CommandType;

	model: Models_And_Ask_Me;
	systemPrompt: string;
	outputVariableName: string;
	promptTemplate: {
		enable: boolean;
		name: string;
	};
	modelParameters: Partial<OpenAIModelParameters>;

	constructor() {
		super("AI Assistant", CommandType.AIAssistant);

		const defaults = settingsStore.getState().ai;

		this.model = defaults.defaultModel;
		this.systemPrompt = defaults.defaultSystemPrompt;
		this.outputVariableName = "output";
		this.promptTemplate = { enable: false, name: "" };
		this.modelParameters = {
			temperature: DEFAULT_TEMPERATURE,
			top_p: DEFAULT_TOP_P,
			frequency_penalty: DEFAULT_FREQUENCY_PENALTY,
			presence_penalty: DEFAULT_PRESENCE_PENALTY,
		};
	}
}
