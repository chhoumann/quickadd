import type { Models_And_Ask_Me } from "src/ai/models";
import { Command } from "../Command";
import { CommandType } from "../CommandType";
import type { IAIAssistantCommand } from "./IAIAssistantCommand";
import { settingsStore } from "src/settingsStore";

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

	constructor() {
		super("AI Assistant", CommandType.AIAssistant);

		const defaults = settingsStore.getState().ai;

		this.model = defaults.defaultModel;
		this.systemPrompt = defaults.defaultSystemPrompt;
		this.outputVariableName = "output";
		this.promptTemplate = { enable: false, name: "" };
	}
}
