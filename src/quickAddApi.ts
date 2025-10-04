import type { App } from "obsidian";
import { MarkdownView } from "obsidian";
import { ChunkedPrompt, getTokenCount, Prompt } from "./ai/AIAssistant";
import {
	getModelByName,
	getModelNames,
	getModelProvider,
} from "./ai/aiHelpers";
import type { OpenAIModelParameters } from "./ai/OpenAIModelParameters";
import type { Model } from "./ai/Provider";
import { CompleteFormatter } from "./formatters/completeFormatter";
import GenericCheckboxPrompt from "./gui/GenericCheckboxPrompt/genericCheckboxPrompt";
import GenericInfoDialog from "./gui/GenericInfoDialog/GenericInfoDialog";
import GenericInputPrompt from "./gui/GenericInputPrompt/GenericInputPrompt";
import GenericSuggester from "./gui/GenericSuggester/genericSuggester";
import GenericWideInputPrompt from "./gui/GenericWideInputPrompt/GenericWideInputPrompt";
import GenericYesNoPrompt from "./gui/GenericYesNoPrompt/GenericYesNoPrompt";
import InputSuggester from "./gui/InputSuggester/inputSuggester";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type QuickAdd from "./main";
import { OnePageInputModal } from "./preflight/OnePageInputModal";
import type { FieldRequirement } from "./preflight/RequirementCollector";
import { settingsStore } from "./settingsStore";
import type IChoice from "./types/choices/IChoice";
import { getDate } from "./utilityObsidian";
import { reportError } from "./utils/errorUtils";
import { FieldSuggestionCache } from "./utils/FieldSuggestionCache";
import { FieldSuggestionFileFilter } from "./utils/FieldSuggestionFileFilter";
import { InlineFieldParser } from "./utils/InlineFieldParser";
import { MacroAbortError } from "./errors/MacroAbortError";

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
					type: "text" | "textarea" | "dropdown" | "date" | "field-suggest" | "suggester";
					placeholder?: string;
					defaultValue?: string;
					options?: string[];
					dateFormat?: string;
					description?: string;
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

					missing.push({
						id: spec.id,
						label: spec.label ?? spec.id,
						type: spec.type,
						placeholder: spec.placeholder,
						defaultValue: spec.defaultValue,
						options: spec.options,
						dateFormat: spec.dateFormat,
						description: spec.description,
						suggesterConfig: spec.suggesterConfig,
						source: "script",
					});
				}

				let collected: Record<string, string> = {};
				if (missing.length > 0) {
					const modal = new OnePageInputModal(
						app,
						missing,
						choiceExecutor.variables,
					);
					collected = await modal.waitForClose;
				}

				const result = { ...existing, ...collected };
				Object.entries(result).forEach(([k, v]) =>
					choiceExecutor.variables.set(k, v),
				);
				return result;
			},
			inputPrompt: (header: string, placeholder?: string, value?: string) => {
				return QuickAddApi.inputPrompt(app, header, placeholder, value);
			},
			wideInputPrompt: (
				header: string,
				placeholder?: string,
				value?: string,
			) => {
				return QuickAddApi.wideInputPrompt(app, header, placeholder, value);
			},
			yesNoPrompt: (header: string, text?: string) => {
				return QuickAddApi.yesNoPrompt(app, header, text);
			},
			infoDialog: (header: string, text: string[] | string) => {
				return QuickAddApi.infoDialog(app, header, text);
			},
			suggester: (
				displayItems:
					| string[]
					| ((value: string, index?: number, arr?: string[]) => string[]),
				actualItems: string[],
				placeholder?: string,
				allowCustomInput = false,
				options?: { renderItem?: (value: string, el: HTMLElement) => void },
			) => {
				return QuickAddApi.suggester(
					app,
					displayItems,
					actualItems,
					placeholder,
					allowCustomInput,
					options,
				);
			},
			checkboxPrompt: (items: string[], selectedItems?: string[]) => {
				return QuickAddApi.checkboxPrompt(app, items, selectedItems);
			},
			executeChoice: async (
				choiceName: string,
				variables?: Record<string, unknown>,
			) => {
				const choice: IChoice = plugin.getChoiceByName(choiceName);
				if (!choice)
					reportError(
						new Error(`Choice named '${choiceName}' not found`),
						"API executeChoice error",
					);

				if (variables) {
					Object.keys(variables).forEach((key) => {
						choiceExecutor.variables.set(key, variables[key]);
					});
				}

				await choiceExecutor.execute(choice);
				choiceExecutor.variables.clear();
			},
			format: async (
				input: string,
				variables?: { [key: string]: unknown },
				shouldClearVariables = true,
			) => {
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

				if (shouldClearVariables) {
					choiceExecutor.variables.clear();
				}

				return output;
			},
			ai: {
				prompt: async (
					prompt: string,
					model: Model | string,
					settings?: Partial<{
						variableName: string;
						shouldAssignVariables: boolean;
						modelOptions: Partial<OpenAIModelParameters>;
						showAssistantMessages: boolean;
						systemPrompt: string;
					}>,
				): Promise<{ [key: string]: string }> => {
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

					let _model: Model;
					if (typeof model === "string") {
						const foundModel = getModelByName(model);
						if (!foundModel) {
							throw new Error(`Model '${model}' not found.`);
						}

						_model = foundModel;
					} else {
						_model = model;
					}

					const modelProvider = getModelProvider(_model.name);

					if (!modelProvider) {
						throw new Error(`Model '${_model.name}' not found in any provider`);
					}

					const assistantRes = await Prompt(
						app,
						{
							model: _model,
							prompt,
							apiKey: modelProvider.apiKey,
							modelOptions: settings?.modelOptions ?? {},
							outputVariableName: settings?.variableName ?? "output",
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

					if (settings?.shouldAssignVariables) {
						// Copy over `output` and `output-quoted` to the variables (if 'outout' is variable name)
						Object.assign(choiceExecutor.variables, assistantRes);
					}

					return assistantRes;
				},
				chunkedPrompt: async (
					text: string,
					promptTemplate: string,
					model: Model | string,
					settings?: Partial<{
						variableName: string;
						shouldAssignVariables: boolean;
						modelOptions: Partial<OpenAIModelParameters>;
						showAssistantMessages: boolean;
						systemPrompt: string;
						chunkSeparator: RegExp;
						chunkJoiner: string;
						shouldMerge: boolean;
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

					let _model: Model;
					if (typeof model === "string") {
						const foundModel = getModelByName(model);
						if (!foundModel) {
							throw new Error(`Model ${model} not found.`);
						}

						_model = foundModel;
					} else {
						_model = model;
					}

					const modelProvider = getModelProvider(_model.name);

					if (!modelProvider) {
						throw new Error(`Model '${_model.name}' not found in any provider`);
					}

					const assistantRes = await ChunkedPrompt(
						app,
						{
							model: _model,
							text,
							promptTemplate,
							chunkSeparator: settings?.chunkSeparator ?? /\n/,
							apiKey: modelProvider.apiKey,
							modelOptions: settings?.modelOptions ?? {},
							outputVariableName: settings?.variableName ?? "output",
							showAssistantMessages: settings?.showAssistantMessages ?? true,
							systemPrompt:
								settings?.systemPrompt ?? AISettings.defaultSystemPrompt,
							resultJoiner: settings?.chunkJoiner ?? "\n",
							shouldMerge: settings?.shouldMerge ?? true,
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

					if (settings?.shouldAssignVariables) {
						// Copy over `output` and `output-quoted` to the variables (if 'outout' is variable name)
						Object.assign(choiceExecutor.variables, assistantRes);
					}

					return assistantRes;
				},
				getModels: () => {
					return getModelNames();
				},
				getMaxTokens: (modelName: string) => {
					const model = getModelByName(modelName);

					if (!model) {
						throw new Error(`Model ${modelName} not found.`);
					}

					return model.maxTokens;
				},
				countTokens(text: string, model: Model) {
					return getTokenCount(text, model);
				},
			},
			utility: {
				getClipboard: async () => {
					return await navigator.clipboard.readText();
				},
				setClipboard: async (text: string) => {
					return await navigator.clipboard.writeText(text);
				},
				getSelectedText: () => {
					const activeView = app.workspace.getActiveViewOfType(MarkdownView);

					if (!activeView) {
						reportError(
							new Error("No active view"),
							"Could not get selected text",
						);
						return;
					}

					if (!activeView.editor.somethingSelected()) {
						reportError(
							new Error("No text selected"),
							"Could not get selected text",
						);
						return;
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
						tags?: string[];
						includeInline?: boolean;
					},
				) => {
					const filters = {
						folder: options?.folder,
						tags: options?.tags,
						inline: options?.includeInline ?? false,
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
								value.forEach((x) => {
									const strValue = x.toString().trim();
									if (strValue) values.add(strValue);
								});
							} else if (typeof value !== "object") {
								const strValue = value.toString().trim();
								if (strValue) values.add(strValue);
							}
						}

						// Get values from inline fields if requested
						if (filters.inline) {
							const content = await app.vault.read(file);
							const inlineValues = InlineFieldParser.getFieldValues(
								content,
								fieldName,
							);
							inlineValues.forEach((v) => values.add(v));
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
	) {
		try {
			return await GenericInputPrompt.Prompt(app, header, placeholder, value);
		} catch {
			if (settingsStore.getState().abortMacroOnCancelledInput) {
				throw new MacroAbortError("Input cancelled by user");
			}
			return undefined;
		}
	}

	public static async wideInputPrompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
	) {
		try {
			return await GenericWideInputPrompt.Prompt(
				app,
				header,
				placeholder,
				value,
			);
		} catch {
			if (settingsStore.getState().abortMacroOnCancelledInput) {
				throw new MacroAbortError("Input cancelled by user");
			}
			return undefined;
		}
	}

	public static async yesNoPrompt(app: App, header: string, text?: string) {
		try {
			return await GenericYesNoPrompt.Prompt(app, header, text);
		} catch {
			if (settingsStore.getState().abortMacroOnCancelledInput) {
				throw new MacroAbortError("Input cancelled by user");
			}
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
		} catch {
			return undefined;
		}
	}

	public static async suggester(
		app: App,
		displayItems:
			| string[]
			| ((value: string, index?: number, arr?: string[]) => string[]),
		actualItems: string[],
		placeholder?: string,
		allowCustomInput = false,
		options?: { renderItem?: (value: string, el: HTMLElement) => void },
	) {
		try {
			let displayedItems;

			if (typeof displayItems === "function") {
				displayedItems = actualItems.map(displayItems);
			} else {
				displayedItems = displayItems;
			}

			if (allowCustomInput) {
				return await InputSuggester.Suggest(
					app,
					displayedItems as string[],
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
				displayedItems as string[],
				actualItems,
				placeholder,
				options?.renderItem,
			);
		} catch {
			if (settingsStore.getState().abortMacroOnCancelledInput) {
				throw new MacroAbortError("Input cancelled by user");
			}
			return undefined;
		}
	}

	public static async checkboxPrompt(
		app: App,
		items: string[],
		selectedItems?: string[],
	) {
		try {
			return await GenericCheckboxPrompt.Open(app, items, selectedItems);
		} catch {
			if (settingsStore.getState().abortMacroOnCancelledInput) {
				throw new MacroAbortError("Input cancelled by user");
			}
			return undefined;
		}
	}
}
