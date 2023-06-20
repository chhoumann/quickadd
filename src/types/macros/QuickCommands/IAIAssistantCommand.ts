import type { Model, Models_And_Ask_Me } from "src/ai/models";
import type { ICommand } from "../ICommand";
import type { OpenAIModelParameters } from "src/ai/OpenAIModelParameters";

interface IBaseAIAssistantCommand extends ICommand {
	model: string;
	systemPrompt: string;
	outputVariableName: string;
	modelParameters: Partial<OpenAIModelParameters>;
}

export interface IAIAssistantCommand extends IBaseAIAssistantCommand {
	model: Models_And_Ask_Me;
	promptTemplate: {
		enable: boolean;
		name: string;
	};
}

export interface IInfiniteAIAssistantCommand extends IBaseAIAssistantCommand {
	model: Model;
	resultJoiner: string;
	chunkSeparator: string;
	maxChunkTokens: number;
	mergeChunks: boolean;
}
