import type { ICommand } from "../ICommand";
import type { ModelRef } from "src/ai/Provider";
import type { OpenAIModelParameters } from "src/ai/OpenAIModelParameters";

interface IBaseAIAssistantCommand extends ICommand {
	/** Model name, or the "Ask me" sentinel. Kept in sync with modelRef (legacy readers, downgrades). */
	model: string;
	/**
	 * Provider-scoped identity of the pinned model. Preferred over `model` at
	 * runtime; absent for "Ask me" and for commands from pre-2.19 data that the
	 * migration could not resolve. Writers keep `model === modelRef.name`.
	 */
	modelRef?: ModelRef;
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
