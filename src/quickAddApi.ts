import type { App } from "obsidian";
import { getActiveMarkdownEditorView } from "./utils/activeMarkdownEditor";
import {
	ChunkedPrompt,
	clearAIRequestLogEntries,
	getAIRequestLogEntryById,
	getAIRequestLogEntries,
	getLastAIRequestLogEntry,
	Prompt,
} from "./ai/AIAssistant";
import { estimateTokenCount } from "./ai/tokenEstimator";
import {
	getModelNames,
	resolveModelInputOrThrow,
	type ScriptModelInput,
} from "./ai/aiHelpers";
import type { OpenAIModelParameters } from "./ai/OpenAIModelParameters";
import type { Model } from "./ai/Provider";
import { resolveProviderApiKey } from "./ai/providerSecrets";
import { Agent } from "./ai/tools/Agent";
import type {
	AgentConfig,
	QATool,
	StopCondition,
	ToolDefinitionInput,
} from "./ai/tools/aiToolTypes";
import { createVaultTools } from "./ai/tools/builtins/vaultTools";
import { createWorkspaceTools } from "./ai/tools/builtins/workspaceTools";
import { createSystemTools } from "./ai/tools/builtins/systemTools";
import type { BuiltinGroupOptions } from "./ai/tools/builtins/shared";
import { assertAssignableVariableName } from "./ai/tools/assignableVariable";
import { CompleteFormatter } from "./formatters/completeFormatter";
import GenericCheckboxPrompt from "./gui/GenericCheckboxPrompt/genericCheckboxPrompt";
import GenericInfoDialog from "./gui/GenericInfoDialog/GenericInfoDialog";
import GenericInputPrompt from "./gui/GenericInputPrompt/GenericInputPrompt";
import GenericSuggester from "./gui/GenericSuggester/genericSuggester";
import GenericWideInputPrompt from "./gui/GenericWideInputPrompt/GenericWideInputPrompt";
import GenericYesNoPrompt from "./gui/GenericYesNoPrompt/GenericYesNoPrompt";
import InputSuggester from "./gui/InputSuggester/inputSuggester";
import VDateInputPrompt from "./gui/VDateInputPrompt/VDateInputPrompt";
import { normalizeDisplayItem } from "./gui/suggesters/utils";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type QuickAdd from "./main";
import { OnePageInputModal } from "./preflight/OnePageInputModal";
import type { FieldRequirement } from "./preflight/RequirementCollector";
import { settingsStore } from "./settingsStore";
import { log } from "./logger/logManager";
import type IChoice from "./types/choices/IChoice";
import { getDate } from "./utilityObsidian";
import { isCancellationError, reportError } from "./utils/errorUtils";
import { FieldSuggestionCache } from "./utils/FieldSuggestionCache";
import { FieldSuggestionFileFilter } from "./utils/FieldSuggestionFileFilter";
import { InlineFieldParser } from "./utils/InlineFieldParser";
import { MacroAbortError } from "./errors/MacroAbortError";
import { UserCancelError } from "./errors/UserCancelError";
import { formatISODate } from "./utils/dateParser";
import type { InputPromptOptions } from "./types/inputPrompt";
import type { NumericInputConfig, SliderConfig } from "./utils/valueSyntax";
import {
	applyTemplateToNote,
	isMarkdownTemplatePath,
} from "./engine/applyTemplateToActiveNote";
import {
	isTemplateInsertMode,
	templateInsertModes,
	type TemplateInsertModeId,
} from "./engine/TemplateInsertEngine";

// Emit the countTokens deprecation hint at most once per session (console only,
// via log.logMessage — never a Notice — so scripts calling it in a loop aren't spammed).
let warnedCountTokensDeprecated = false;

function snapshotVariables(
	vars: Map<string, unknown>,
): Array<[string, unknown]> {
	return Array.from(vars.entries());
}

function restoreVariables(
	vars: Map<string, unknown>,
	snapshot: Array<[string, unknown]>,
): void {
	vars.clear();
	for (const [key, value] of snapshot) {
		vars.set(key, value);
	}
}

function sanitizeNumericConfig(
	value: NumericInputConfig | undefined,
): NumericInputConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const config: NumericInputConfig = {};
	if (typeof value.min === "number" && Number.isFinite(value.min)) {
		config.min = value.min;
	}
	if (typeof value.max === "number" && Number.isFinite(value.max)) {
		config.max = value.max;
	}
	if (
		config.min !== undefined &&
		config.max !== undefined &&
		config.max < config.min
	) {
		delete config.min;
		delete config.max;
	}
	if (
		typeof value.step === "number" &&
		Number.isFinite(value.step) &&
		value.step > 0
	) {
		config.step = value.step;
	}
	return Object.keys(config).length > 0 ? config : undefined;
}

type RequestSliderConfig = {
	min: number;
	max: number;
	step?: number;
};

function sanitizeSliderConfig(
	value: RequestSliderConfig | undefined,
): SliderConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const { min, max } = value;
	const step = value.step ?? 1;
	if (
		typeof min !== "number" ||
		typeof max !== "number" ||
		typeof step !== "number" ||
		!Number.isFinite(min) ||
		!Number.isFinite(max) ||
		!Number.isFinite(step) ||
		max <= min ||
		step <= 0
	) {
		return undefined;
	}
	return { min, max, step };
}

export class QuickAddApi {
	public static GetApi(
		app: App,
		plugin: QuickAdd,
		choiceExecutor: IChoiceExecutor,
	) {
		return {
			/**
			 * Open a single one-page modal to collect multiple inputs at once from a script.
			 * Any values already present in variables will be used as defaults and not re-asked.
			 *
			 * Example spec items:
			 * { id: "project", label: "Project", type: "text", defaultValue: "Inbox" }
			 * { id: "tags", label: "Tags", type: "suggester", options: ["#work", "#personal"], suggesterConfig: { multiSelect: true } }
			 */
			requestInputs: async (
				inputs: Array<{
					id: string;
					label?: string;
					type:
						| "text"
						| "number"
						| "textarea"
						| "dropdown"
						| "date"
						| "field-suggest"
						| "suggester"
						| "slider";
					placeholder?: string;
					defaultValue?: string;
					numericConfig?: NumericInputConfig;
					sliderConfig?: RequestSliderConfig;
					options?: string[];
					dateFormat?: string;
					description?: string;
					optional?: boolean;
					suggesterConfig?: {
						allowCustomInput?: boolean;
						caseSensitive?: boolean;
						multiSelect?: boolean;
					};
				}>,
			): Promise<Record<string, string>> => {
				// If all inputs already have values, return them immediately
				const existing: Record<string, string> = {};
				const missing: FieldRequirement[] = [];
				for (const spec of inputs) {
					const val = choiceExecutor.variables.get(spec.id) as
						| string
						| undefined;
					// Empty string is considered intentional and should not be re-asked
					if (val !== undefined && val !== null) {
						existing[spec.id] = String(val);
						continue;
					}
					const sliderConfig = sanitizeSliderConfig(spec.sliderConfig);
					const numericConfig =
						sliderConfig ?? sanitizeNumericConfig(spec.numericConfig);
					const type =
						spec.type === "slider" && !sliderConfig ? "number" : spec.type;

					missing.push({
						id: spec.id,
						label: spec.label ?? spec.id,
						type,
						placeholder: spec.placeholder,
						defaultValue: spec.defaultValue,
						numericConfig,
						sliderConfig,
						options: spec.options,
						dateFormat: spec.dateFormat,
						description: spec.description,
						optional: spec.optional,
						suggesterConfig: spec.suggesterConfig,
						source: "script",
					});
				}

				let collected: Record<string, string> = {};
				if (missing.length > 0) {
					// Route the batch form to a remote interactive session (Raycast)
					// when one is driving this run; otherwise open the Obsidian modal.
					const provider = choiceExecutor?.promptProvider;
					if (provider) {
						try {
							collected = await provider.requestInputs(missing);
						} catch (error) {
							throwIfPromptCancelled(error);
							throw error;
						}
					} else {
						const modal = new OnePageInputModal(
							app,
							missing,
							choiceExecutor.variables,
						);
						try {
							collected = await modal.waitForClose;
						} catch (error) {
							throwIfPromptCancelled(error);
							throw error;
						}
					}
				}

				const rawResult = { ...existing, ...collected };

				// The modal omits blank/unparseable date keys so the preflight
				// flow can re-prompt sequentially. Scripts have no such
				// fallback — keep the requestInputs contract that every
				// requested id resolves (empty answer = "").
				for (const spec of inputs) {
					if (rawResult[spec.id] === undefined) rawResult[spec.id] = "";
				}

				// Store raw values (including @date:ISO) for downstream processors
				Object.entries(rawResult).forEach(([k, v]) =>
					choiceExecutor.variables.set(k, v),
				);

				// Return user-friendly values that honor dateFormat when provided
				const formattedResult: Record<string, string> = {};
				for (const spec of inputs) {
					const value = rawResult[spec.id];
					if (value === undefined) continue;

					let output = value;
					if (
						spec.type === "date" &&
						spec.dateFormat &&
						typeof value === "string" &&
						value.startsWith("@date:")
					) {
						const iso = value.slice(6);
						const formatted = formatISODate(iso, spec.dateFormat);
						if (formatted) output = formatted;
					}

					formattedResult[spec.id] = output;
				}

				return formattedResult;
			},
			inputPrompt: (
				header: string,
				placeholder?: string,
				value?: string,
				options?: InputPromptOptions,
			) => {
				const provider = choiceExecutor?.promptProvider;
				if (provider) return provider.inputPrompt(header, placeholder, value);
				return QuickAddApi.inputPrompt(app, header, placeholder, value, options);
			},
			datePrompt: (
				header: string,
				options?: {
					placeholder?: string;
					defaultValue?: string;
					dateFormat?: string;
				},
			) => {
				const provider = choiceExecutor?.promptProvider;
				if (provider) return provider.datePrompt(header, options);
				return QuickAddApi.datePrompt(app, header, options);
			},
			wideInputPrompt: (
				header: string,
				placeholder?: string,
				value?: string,
				options?: InputPromptOptions,
			) => {
				const provider = choiceExecutor?.promptProvider;
				if (provider) return provider.wideInputPrompt(header, placeholder, value);
				return QuickAddApi.wideInputPrompt(
					app,
					header,
					placeholder,
					value,
					options,
				);
			},
			yesNoPrompt: (header: string, text?: string) => {
				const provider = choiceExecutor?.promptProvider;
				if (provider) return provider.yesNoPrompt(header, text);
				return QuickAddApi.yesNoPrompt(app, header, text);
			},
			infoDialog: (header: string, text: string[] | string) => {
				const provider = choiceExecutor?.promptProvider;
				if (provider) return provider.infoDialog(header, text);
				return QuickAddApi.infoDialog(app, header, text);
			},
			suggester: (
				displayItems:
					| string[]
					| ((value: string, index?: number, arr?: string[]) => string),
				actualItems: string[],
				placeholder?: string,
				allowCustomInput = false,
				options?: { renderItem?: (value: string, el: HTMLElement) => void; },
			) => {
				// Route to a remote interactive session (Raycast) when one is driving
				// this execution; otherwise open the Obsidian suggester modal.
				const provider = choiceExecutor?.promptProvider;
				if (provider) {
					return provider.suggester(
						displayItems,
						actualItems,
						placeholder,
						allowCustomInput,
					);
				}
				return QuickAddApi.suggester(
					app,
					displayItems,
					actualItems,
					placeholder,
					allowCustomInput,
					options,
				);
			},
			checkboxPrompt: (
				items: string[],
				selectedItems?: string[],
				header?: string,
			) => {
				const provider = choiceExecutor?.promptProvider;
				if (provider) {
					return provider.checkboxPrompt(items, selectedItems, header);
				}
				return QuickAddApi.checkboxPrompt(
					app,
					items,
					selectedItems,
					header,
				);
			},
			executeChoice: async (
				choiceName: string,
				variables?: Record<string, unknown>,
			) => {
				// getChoiceByName THROWS when the name doesn't match a choice, so
				// look it up defensively: report + return (don't abort the macro)
				// to honor the documented "reports an error, does not throw"
				// contract. The `!choice` fallback also covers any non-throwing
				// lookup that yields a falsy result.
				let choice: IChoice | undefined;
				try {
					choice = plugin.getChoiceByName(choiceName);
				} catch {
					choice = undefined;
				}

				if (!choice) {
					reportError(
						new Error(`Choice named '${choiceName}' not found`),
						"API executeChoice error",
					);
					return;
				}

				if (variables) {
					Object.keys(variables).forEach((key) => {
						choiceExecutor.variables.set(key, variables[key]);
					});
				}

				await choiceExecutor.execute(choice);
				const abort = choiceExecutor.consumeAbortSignal?.();
				choiceExecutor.variables.clear();
				if (abort) {
					throw abort;
				}
			},
			/**
			 * Applies a template to the active note without creating a new file.
			 * Runs the full QuickAdd format pipeline on the template content.
			 *
			 * @param templatePath Vault path to the template file.
			 * @param options.mode How to apply: "cursor" | "top" | "bottom" |
			 *   "replace". Defaults to "replace" for empty notes and "bottom"
			 *   otherwise.
			 * @returns The target file, or null if nothing was applied.
			 */
			applyTemplateToActiveFile: async (
				templatePath: string,
				options?: { mode?: TemplateInsertModeId },
			) => {
				if (!templatePath) {
					throw new Error(
						"applyTemplateToActiveFile requires a template path.",
					);
				}

				if (!isMarkdownTemplatePath(templatePath)) {
					throw new Error(
						"applyTemplateToActiveFile only supports markdown templates. Canvas and base templates cannot be applied to a markdown note.",
					);
				}

				if (options?.mode !== undefined && !isTemplateInsertMode(options.mode)) {
					throw new Error(
						`Invalid mode '${String(options.mode)}'. Valid modes: ${templateInsertModes
							.map((mode) => mode.id)
							.join(", ")}.`,
					);
				}

				const snapshot = snapshotVariables(choiceExecutor.variables);
				try {
					return await applyTemplateToNote(app, plugin, {
						templatePath,
						mode: options?.mode,
						choiceExecutor,
					});
				} finally {
					restoreVariables(choiceExecutor.variables, snapshot);
				}
			},
			format: async (
				input: string,
				variables?: { [key: string]: unknown; },
				shouldClearVariables = true,
			) => {
				const snapshot = shouldClearVariables
					? snapshotVariables(choiceExecutor.variables)
					: null;

				if (variables) {
					Object.keys(variables).forEach((key) => {
						choiceExecutor.variables.set(key, variables[key]);
					});
				}

				const output = await new CompleteFormatter(
					app,
					plugin,
					choiceExecutor,
				).formatFileContent(input);

				if (shouldClearVariables && snapshot) {
					restoreVariables(choiceExecutor.variables, snapshot);
				}

				return output;
			},
			ai: {
				prompt: async (
					prompt: string,
					model: ScriptModelInput,
					settings?: Partial<{
						variableName: string;
						shouldAssignVariables: boolean;
						/** Alias: set the output variable name AND assign it (mirrors ai.agent). */
						assignToVariable: string;
						modelOptions: Partial<OpenAIModelParameters>;
						showAssistantMessages: boolean;
						systemPrompt: string;
					}>,
				): Promise<{ [key: string]: string; }> => {
					const pluginSettings = settingsStore.getState();
					const AISettings = pluginSettings.ai;

					if (pluginSettings.disableOnlineFeatures) {
						throw new Error(
							"Rejecting request to `prompt` via API AI module. Online features are disabled in settings.",
						);
					}

					const formatter = QuickAddApi.GetApi(
						app,
						plugin,
						choiceExecutor,
					).format;

					const { model: _model, provider: modelProvider } =
						resolveModelInputOrThrow(model);

					const apiKey = await resolveProviderApiKey(app, modelProvider);

					if (settings?.assignToVariable) {
						assertAssignableVariableName(settings.assignToVariable);
					}

					const assistantRes = await Prompt(
						app,
						{
							model: _model,
							provider: modelProvider,
							prompt,
							apiKey,
							modelOptions: settings?.modelOptions ?? {},
							outputVariableName:
								// `||` not `??`: an empty assignToVariable ("") means "no explicit
								// variable" (matching ai.agent's length>0 check), so fall through.
								settings?.assignToVariable || settings?.variableName || "output",
							showAssistantMessages: settings?.showAssistantMessages ?? true,
							systemPrompt:
								settings?.systemPrompt ?? AISettings.defaultSystemPrompt,
						},
						(txt: string, variables?: Record<string, unknown>) => {
							return formatter(txt, variables, false);
						},
					);

					if (!assistantRes) {
						reportError(
							new Error("AI Assistant returned null"),
							"AI Prompt error",
						);
						return {};
					}

					if (settings?.shouldAssignVariables || settings?.assignToVariable) {
						// Copy over `output` and `output-quoted` to the variables (if 'output' is variable name)
						Object.entries(assistantRes).forEach(([key, value]) => {
							choiceExecutor.variables.set(key, value);
						});
					}

					return assistantRes;
				},
				chunkedPrompt: async (
					text: string,
					promptTemplate: string,
					model: ScriptModelInput,
					settings?: Partial<{
						variableName: string;
						shouldAssignVariables: boolean;
						/** Alias: set the output variable name AND assign it (mirrors ai.agent). */
						assignToVariable: string;
						modelOptions: Partial<OpenAIModelParameters>;
						showAssistantMessages: boolean;
						systemPrompt: string;
						chunkSeparator: RegExp;
						chunkJoiner: string;
						shouldMerge: boolean;
						maxChunkTokens: number;
					}>,
					existingVariables?: Record<string, unknown>,
				) => {
					const pluginSettings = settingsStore.getState();
					const AISettings = pluginSettings.ai;

					if (pluginSettings.disableOnlineFeatures) {
						throw new Error(
							"Rejecting request to `prompt` via API AI module. Online features are disabled in settings.",
						);
					}

					const formatter = QuickAddApi.GetApi(
						app,
						plugin,
						choiceExecutor,
					).format;

					const { model: _model, provider: modelProvider } =
						resolveModelInputOrThrow(model);

					const apiKey = await resolveProviderApiKey(app, modelProvider);

					if (settings?.assignToVariable) {
						assertAssignableVariableName(settings.assignToVariable);
					}

					const assistantRes = await ChunkedPrompt(
						app,
						{
							model: _model,
							provider: modelProvider,
							text,
							promptTemplate,
							chunkSeparator: settings?.chunkSeparator ?? /\n/,
							apiKey,
							modelOptions: settings?.modelOptions ?? {},
							outputVariableName:
								// `||` not `??`: an empty assignToVariable ("") means "no explicit
								// variable" (matching ai.agent's length>0 check), so fall through.
								settings?.assignToVariable || settings?.variableName || "output",
							showAssistantMessages: settings?.showAssistantMessages ?? true,
							systemPrompt:
								settings?.systemPrompt ?? AISettings.defaultSystemPrompt,
							resultJoiner: settings?.chunkJoiner ?? "\n",
							shouldMerge: settings?.shouldMerge ?? true,
							maxChunkTokens: settings?.maxChunkTokens,
						},
						(txt: string, variables?: Record<string, unknown>) => {
							const mergedVariables = {
								...existingVariables,
								...variables,
							};

							return formatter(txt, mergedVariables, false);
						},
					);

					if (!assistantRes) {
						reportError(
							new Error("AI Assistant returned null"),
							"Chunked AI Prompt error",
						);
						return {};
					}

					if (settings?.shouldAssignVariables || settings?.assignToVariable) {
						// Copy over `output` and `output-quoted` to the variables (if 'output' is variable name)
						Object.entries(assistantRes).forEach(([key, value]) => {
							choiceExecutor.variables.set(key, value);
						});
					}

					return assistantRes;
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
			},
			utility: {
				getClipboard: async () => {
					return await navigator.clipboard.readText();
				},
				setClipboard: async (text: string) => {
					return await navigator.clipboard.writeText(text);
				},
				getSelection: () => {
					const activeView = getActiveMarkdownEditorView(app);

					if (!activeView) {
						return "";
					}

					return activeView.editor.getSelection() ?? "";
				},
				getSelectedText: () => {
					const activeView = getActiveMarkdownEditorView(app);

					if (!activeView) {
						reportError(
							new Error("No active Markdown editor"),
							"Could not get selected text",
						);
						return "";
					}

					if (!activeView.editor.somethingSelected()) {
						reportError(
							new Error("No text selected"),
							"Could not get selected text",
						);
						return "";
					}

					return activeView.editor.getSelection();
				},
			},
			date: {
				now: (format?: string, offset?: number) => {
					return getDate({ format, offset });
				},
				tomorrow: (format?: string) => {
					return getDate({ format, offset: 1 });
				},
				yesterday: (format?: string) => {
					return getDate({ format, offset: -1 });
				},
			},
			fieldSuggestions: {
				getFieldValues: async (
					fieldName: string,
					options?: {
						folder?: string;
						folders?: string[];
						tags?: string[];
						includeInline?: boolean;
						includeInlineCodeBlocks?: string[];
					},
				) => {
					const inlineCodeBlocks = options?.includeInlineCodeBlocks
						?.map((value) => value.trim().toLowerCase())
						.filter((value) => value.length > 0);
					const filters = {
						folder: options?.folder,
						folders: options?.folders,
						tags: options?.tags,
						inline: options?.includeInline ?? false,
						inlineCodeBlocks,
					};

					// Get all markdown files and apply filters
					let files = app.vault.getMarkdownFiles();
					files = FieldSuggestionFileFilter.filterFiles(
						files,
						filters,
						(file) => app.metadataCache.getFileCache(file),
					);

					const values = new Set<string>();

					// Collect field values from filtered files
					for (const file of files) {
						const cache = app.metadataCache.getFileCache(file);

						// Get values from YAML frontmatter
						const value = cache?.frontmatter?.[fieldName];
						if (value !== undefined && value !== null) {
							if (Array.isArray(value)) {
								// Skip null/undefined and nested objects before
								// stringifying — String(null) is "null" and an
								// object yields "[object Object]"; both are noise.
								value.forEach((x) => {
									if (x === undefined || x === null) return;
									if (typeof x === "object") return;
									const strValue = String(x).trim();
									if (strValue) values.add(strValue);
								});
							} else if (typeof value !== "object") {
								const strValue = String(value).trim();
								if (strValue) values.add(strValue);
							}
						}

						// Get values from inline fields if requested
						if (filters.inline) {
							// One unreadable file must not abort the whole call;
							// skip it (mirrors FieldValueCollector).
							try {
								const content = await app.vault.read(file);
								const inlineValues = InlineFieldParser.getFieldValues(
									content,
									fieldName,
									{
										includeCodeBlocks: inlineCodeBlocks,
									},
								);
								inlineValues.forEach((v) => values.add(v));
							} catch {
								// Ignore files whose contents cannot be read.
							}
						}
					}

					return Array.from(values).sort();
				},
				clearCache: (fieldName?: string) => {
					const cache = FieldSuggestionCache.getInstance();
					cache.clear(fieldName);
				},
			},
		};
	}

	public static async inputPrompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		options?: InputPromptOptions,
	) {
		try {
			return await GenericInputPrompt.Prompt(
				app,
				header,
				placeholder,
				value,
				undefined,
				options,
			);
		} catch (error) {
			throwIfPromptCancelled(error);
			return undefined;
		}
	}

	public static async datePrompt(
		app: App,
		header: string,
		options?: {
			placeholder?: string;
			defaultValue?: string;
			dateFormat?: string;
		},
	) {
		try {
			const value = await VDateInputPrompt.Prompt(
				app,
				header,
				options?.placeholder,
				options?.defaultValue,
				options?.dateFormat,
			);
			if (value && value.startsWith("@date:")) {
				const iso = value.slice(6);
				const formatted = options?.dateFormat
					? formatISODate(iso, options.dateFormat)
					: null;
				return formatted ?? iso;
			}
			return value;
		} catch (error) {
			throwIfPromptCancelled(error);
			return undefined;
		}
	}

	public static async wideInputPrompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		options?: InputPromptOptions,
	) {
		try {
			return await GenericWideInputPrompt.Prompt(
				app,
				header,
				placeholder,
				value,
				undefined,
				options,
			);
		} catch (error) {
			throwIfPromptCancelled(error);
			return undefined;
		}
	}

	public static async yesNoPrompt(app: App, header: string, text?: string) {
		try {
			return await GenericYesNoPrompt.Prompt(app, header, text);
		} catch (error) {
			throwIfPromptCancelled(error);
			return undefined;
		}
	}

	public static async infoDialog(
		app: App,
		header: string,
		text: string[] | string,
	) {
		try {
			return await GenericInfoDialog.Show(app, header, text);
		} catch (error) {
			throwIfPromptCancelled(error);
			return undefined;
		}
	}

	public static async suggester(
		app: App,
		displayItems:
			| string[]
			| ((value: string, index?: number, arr?: string[]) => string),
		actualItems: string[],
		placeholder?: string,
		allowCustomInput = false,
		options?: { renderItem?: (value: string, el: HTMLElement) => void; },
	) {
		try {
			let displayedItems: string[];

			if (typeof displayItems === "function") {
				displayedItems = actualItems.map((value, index, arr) =>
					normalizeDisplayItem(displayItems(value, index, arr)),
				);
			} else {
				displayedItems = displayItems.map((item) => normalizeDisplayItem(item));
			}

			if (allowCustomInput) {
				return await InputSuggester.Suggest(
					app,
					displayedItems,
					actualItems,
					{
						...(placeholder ? { placeholder } : {}),
						...(options?.renderItem
							? { renderItem: options.renderItem }
							: {}),
					},
				);
			}

			return await GenericSuggester.Suggest(
				app,
				displayedItems,
				actualItems,
				placeholder,
				options?.renderItem,
			);
		} catch (error) {
			throwIfPromptCancelled(error);
			return undefined;
		}
	}

	public static async checkboxPrompt(
		app: App,
		items: string[],
		selectedItems?: string[],
		header?: string,
	) {
		try {
			// Only forward `header` when provided so existing 3-argument call
			// sites stay byte-identical (no trailing `undefined`).
			return await (header === undefined
				? GenericCheckboxPrompt.Open(app, items, selectedItems)
				: GenericCheckboxPrompt.Open(app, items, selectedItems, header));
		} catch (error) {
			throwIfPromptCancelled(error);
			return undefined;
		}
	}
}

function throwIfPromptCancelled(error: unknown): void {
	if (error instanceof MacroAbortError) {
		throw error;
	}
	if (isCancellationError(error)) {
		throw new UserCancelError("Input cancelled by user");
	}
}
