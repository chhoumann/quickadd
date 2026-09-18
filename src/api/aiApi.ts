import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { ChunkedPrompt, Prompt, clearAIRequestLogEntries, getAIRequestLogEntryById, getAIRequestLogEntries, getLastAIRequestLogEntry } from "../ai/AIAssistant";
import { getModelNames, resolveModelInputOrThrow, type ScriptModelInput } from "../ai/aiHelpers";
import type { OpenAIModelParameters } from "../ai/OpenAIModelParameters";
import type { Model } from "../ai/Provider";
import { resolveProviderApiKey } from "../ai/providerSecrets";
import { estimateTokenCount } from "../ai/tokenEstimator";
import { Agent } from "../ai/tools/Agent";
import type { AgentConfig, QATool, StopCondition, ToolDefinitionInput } from "../ai/tools/aiToolTypes";
import { assertAssignableVariableName } from "../ai/tools/assignableVariable";
import { createVaultTools } from "../ai/tools/builtins/vaultTools";
import { createWorkspaceTools } from "../ai/tools/builtins/workspaceTools";
import { createSystemTools } from "../ai/tools/builtins/systemTools";
import type { BuiltinGroupOptions } from "../ai/tools/builtins/shared";
import { settingsStore } from "../settingsStore";
import { reportError } from "../utils/errorUtils";
import { log } from "../logger/logManager";

type Format = (text: string, variables?: Record<string, unknown>, clearVariables?: boolean) => Promise<string>;
type PromptSettings = Partial<{
	variableName: string;
	shouldAssignVariables: boolean;
	assignToVariable: string;
	modelOptions: Partial<OpenAIModelParameters>;
	showAssistantMessages: boolean;
	systemPrompt: string;
}>;
let warnedCountTokensDeprecated = false;

export function createAiApi(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor, format: Format) {
	async function promptOptions(model: ScriptModelInput, settings?: PromptSettings) {
		const pluginSettings = settingsStore.getState();
		if (pluginSettings.disableOnlineFeatures) {
			throw new Error("Rejecting request to `prompt` via API AI module. Online features are disabled in settings.");
		}
		const { model: resolvedModel, provider } = resolveModelInputOrThrow(model);
		const apiKey = await resolveProviderApiKey(app, provider);
		if (settings?.assignToVariable) assertAssignableVariableName(settings.assignToVariable);
		return {
			model: resolvedModel,
			provider,
			apiKey,
			modelOptions: settings?.modelOptions ?? {},
			outputVariableName: settings?.assignToVariable || settings?.variableName || "output",
			showAssistantMessages: settings?.showAssistantMessages ?? true,
			systemPrompt: settings?.systemPrompt ?? pluginSettings.ai.defaultSystemPrompt,
		};
	}

	function finishPrompt(result: Awaited<ReturnType<typeof Prompt>>, settings: PromptSettings | undefined, context: string) {
		if (!result) {
			reportError(new Error("AI Assistant returned null"), context);
			return {};
		}
		if (settings?.shouldAssignVariables || settings?.assignToVariable) {
			for (const [key, value] of Object.entries(result)) choiceExecutor.variables.set(key, value);
		}
		return result;
	}

	return {
		prompt: async (prompt: string, model: ScriptModelInput, settings?: PromptSettings) => {
			const result = await Prompt(app, { ...await promptOptions(model, settings), prompt },
				(text: string, variables?: Record<string, unknown>) => format(text, variables, false));
			return finishPrompt(result, settings, "AI Prompt error");
		},
		chunkedPrompt: async (
			text: string,
			promptTemplate: string,
			model: ScriptModelInput,
			settings?: PromptSettings & Partial<{
				chunkSeparator: RegExp;
				chunkJoiner: string;
				shouldMerge: boolean;
				maxChunkTokens: number;
			}>,
			existingVariables?: Record<string, unknown>,
		) => {
			const result = await ChunkedPrompt(app, {
				...await promptOptions(model, settings),
				text,
				promptTemplate,
				chunkSeparator: settings?.chunkSeparator ?? /\n/,
				resultJoiner: settings?.chunkJoiner ?? "\n",
				shouldMerge: settings?.shouldMerge ?? true,
				maxChunkTokens: settings?.maxChunkTokens,
			}, (input, variables) => format(input, { ...existingVariables, ...variables }, false));
			return finishPrompt(result, settings, "Chunked AI Prompt error");
		},
		getModels: () => {
			return getModelNames();
		},
		getMaxTokens: (modelName: ScriptModelInput) => {
			return resolveModelInputOrThrow(modelName).model.maxTokens;
		},
		estimateTokens(text: string) {
			return estimateTokenCount(text);
		},
		// `model` is accepted for backward compatibility but ignored:
		// QuickAdd no longer bundles model-specific tokenizers, so this is
		// a thin alias for the provider-agnostic estimator.
		countTokens(text: string, _model?: Model | string) {
			if (!warnedCountTokensDeprecated) {
				warnedCountTokensDeprecated = true;
				log.logMessage(
					"quickAddApi.ai.countTokens is deprecated and now returns a provider-agnostic estimate (the model argument is ignored). Use estimateTokens(text) instead.",
				);
			}
			return estimateTokenCount(text);
		},
		getRequestLogs(limit = 10) {
			return getAIRequestLogEntries(limit);
		},
		getRequestLogById(id: string) {
			return getAIRequestLogEntryById(id);
		},
		getLastRequestLog() {
			return getLastAIRequestLogEntry();
		},
		clearRequestLogs() {
			clearAIRequestLogEntries();
		},
		/**
		 * Create a tool-calling Agent (#714). Construct once with model/system/
		 * tools/budget, then run `agent.generate({ prompt })` (text + tools) or
		 * `agent.generate({ prompt, schema })` (structured output).
		 */
		agent: (config: AgentConfig): Agent =>
			new Agent(app, plugin, choiceExecutor, config),
		/** Declare a tool for an Agent's `tools` map. Pairs a JSON-Schema with a JS handler. */
		tool: (def: ToolDefinitionInput): QATool => ({
			...def,
			__qaTool: true,
		}),
		/** Stop condition: end the loop once it has taken `n` steps. */
		stepCountIs:
			(n: number): StopCondition =>
				({ stepNumber }) =>
					stepNumber >= n,
		/** Stop condition: end the loop once the named tool has been called. */
		hasToolCall:
			(name: string): StopCondition =>
				({ toolCallNames }) =>
					toolCallNames.includes(name),
		/**
		 * Standard built-in tools (#714), opt-in. Spread a group into an Agent's
		 * `tools` map, e.g. `tools: { ...quickAddApi.ai.tools.vault() }`. Each group
		 * factory accepts { only, exclude, prefix, allowedRoots }. Read tools auto-run;
		 * write tools require confirmation and are path-sanitized + symlink-guarded.
		 */
		tools: {
			vault: (options?: BuiltinGroupOptions) =>
				createVaultTools(app, options),
			workspace: (options?: BuiltinGroupOptions) =>
				createWorkspaceTools(app, options),
			system: (options?: BuiltinGroupOptions) => createSystemTools(options),
		},
	};
}
