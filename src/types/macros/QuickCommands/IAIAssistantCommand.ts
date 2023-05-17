import type { Models_And_Ask_Me } from "src/ai/models";
import type { ICommand } from "../ICommand";
import { OpenAIModelParameters } from "src/ai/OpenAIModelParameters";

export interface IAIAssistantCommand extends ICommand {
	model: Models_And_Ask_Me;
	systemPrompt: string;
	outputVariableName: string;
	promptTemplate: {
		enable: boolean;
		name: string;
	};
	modelParameters: Partial<OpenAIModelParameters>;
}
