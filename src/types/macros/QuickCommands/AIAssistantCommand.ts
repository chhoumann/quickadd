import { Command } from "../Command";
import { CommandType } from "../CommandType";
import type { IAIAssistantCommand } from "./IAIAssistantCommand";
import type { ModelRef } from "src/ai/Provider";
import type { OpenAIModelParameters } from "src/ai/OpenAIModelParameters";

export class AIAssistantCommand extends Command implements IAIAssistantCommand {
	declare id: string;
	declare name: string;
	declare type: CommandType;

	model: string;
	modelRef?: ModelRef;
	systemPrompt: string;
	outputVariableName: string;
	promptTemplate: {
		enable: boolean;
		name: string;
	};
	modelParameters: Partial<OpenAIModelParameters>;

	constructor(defaults: {
		model: string;
		modelRef: ModelRef | undefined;
		systemPrompt: string;
	}) {
		super("AI Assistant", CommandType.AIAssistant);

		this.model = defaults.model;
		this.modelRef = defaults.modelRef ? { ...defaults.modelRef } : undefined;
		this.systemPrompt = defaults.systemPrompt;
		this.outputVariableName = "output";
		this.promptTemplate = { enable: false, name: "" };
		// Empty on purpose: only sampling parameters the user explicitly sets are
		// sent, since current frontier models reject some defaults with a 400.
		this.modelParameters = {};
	}
}
