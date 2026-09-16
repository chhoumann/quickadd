import type { App } from "obsidian";
import type QuickAdd from "./main";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import { CompleteFormatter } from "./formatters/completeFormatter";
import { applyTemplateToNote, isMarkdownTemplatePath } from "./engine/applyTemplateToActiveNote";
import { isTemplateInsertMode, templateInsertModes, type TemplateInsertModeId } from "./engine/TemplateInsertEngine";
import { getActiveEditorSelection, getActiveMarkdownEditorView } from "./utils/activeMarkdownEditor";
import { applyInvocationDate } from "./utils/resolveDateOrigin";
import { reportError } from "./utils/errorUtils";
import { getDate } from "./utilityObsidian";
import type IChoice from "./types/choices/IChoice";
import type { InputPromptOptions } from "./types/inputPrompt";
import { PromptApi } from "./api/promptApi";
import { requestInputs } from "./api/requestInputs";
import { createAiApi } from "./api/aiApi";
import { createFieldSuggestionsApi } from "./api/fieldSuggestionsApi";

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

export class QuickAddApi extends PromptApi {
	public static GetApi(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor) {
		const format = async (
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
		};
		return {
			requestInputs: (inputs: Parameters<typeof requestInputs>[2]) => requestInputs(app, choiceExecutor, inputs),
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
				options?: { date?: string | Date },
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

				if (!applyInvocationDate(choiceExecutor, options?.date)) {
					reportError(
						new Error(`Could not parse date origin '${String(options?.date)}'`),
						"API executeChoice error",
					);
					return;
				}

				if (variables) {
					Object.keys(variables).forEach((key) => {
						choiceExecutor.variables.set(key, variables[key]);
					});
				}

				// The clear stays on the non-throw path only, deliberately: this
				// executor can be a calling macro's own (params.quickAddApi), so the
				// map holds the CALLER's variables too, and a script that catches a
				// cancelled sub-choice and carries on must not lose them. The cost is
				// the long-standing quirk that variables seeded into a cancelled call
				// linger until the next completed one.
				await choiceExecutor.execute(choice);
				const abort = choiceExecutor.consumeAbortSignal?.();
				choiceExecutor.variables.clear();
				if (abort) {
					throw abort;
				}
			},
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
			format,
			ai: createAiApi(app, plugin, choiceExecutor, format),
			utility: {
				getClipboard: async () => {
					return await navigator.clipboard.readText();
				},
				setClipboard: async (text: string) => {
					return await navigator.clipboard.writeText(text);
				},
				getSelection: () => getActiveEditorSelection(app),
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
			fieldSuggestions: createFieldSuggestionsApi(app)
		};
	}
}
