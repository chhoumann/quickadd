import type { ICommand } from "../ICommand";
import type { OpenAIModelParameters } from "src/ai/OpenAIModelParameters";

interface IBaseAIAssistantCommand extends ICommand {
	model: string;
	systemPrompt: string;
	outputVariableName: string;
	modelParameters: Partial<OpenAIModelParameters>;
}

export interface IAIAssistantCommand extends IBaseAIAssistantCommand {
	model: string;
	promptTemplate: {
		enable: boolean;
		name: string;
	};
}

export interface IInfiniteAIAssistantCommand extends IBaseAIAssistantCommand {
	model: string;
	resultJoiner: string;
	chunkSeparator: string;
	maxChunkTokens: number;
	mergeChunks: boolean;
}
