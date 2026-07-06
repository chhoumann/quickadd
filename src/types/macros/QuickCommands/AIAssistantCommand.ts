import { Command } from "../Command";
import { CommandType } from "../CommandType";
import type { IAIAssistantCommand } from "./IAIAssistantCommand";
import { settingsStore } from "src/settingsStore";
import type { OpenAIModelParameters } from "src/ai/OpenAIModelParameters";

export class AIAssistantCommand extends Command implements IAIAssistantCommand {
	declare id: string;
	declare name: string;
	declare type: CommandType;

	model: string;
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
		// Empty on purpose: only sampling parameters the user explicitly sets are
		// ever sent. Baking in "defaults" (temperature 1 etc.) made every new
		// command carry params that current frontier models reject with a 400.
		this.modelParameters = {};
	}
}
