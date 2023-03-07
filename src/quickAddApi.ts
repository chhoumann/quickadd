import GenericInputPrompt from "./gui/GenericInputPrompt/GenericInputPrompt";
import GenericYesNoPrompt from "./gui/GenericYesNoPrompt/GenericYesNoPrompt";
import GenericInfoDialog from "./gui/GenericInfoDialog/GenericInfoDialog";
import GenericSuggester from "./gui/GenericSuggester/genericSuggester";
import type { App } from "obsidian";
import GenericCheckboxPrompt from "./gui/GenericCheckboxPrompt/genericCheckboxPrompt";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import { log } from "./logger/logManager";
import { CompleteFormatter } from "./formatters/completeFormatter";
import { getDate } from "./utility";
import { MarkdownView } from "obsidian";
import GenericWideInputPrompt from "./gui/GenericWideInputPrompt/GenericWideInputPrompt";

export class QuickAddApi {
	public static GetApi(
		app: App,
		plugin: QuickAdd,
		choiceExecutor: IChoiceExecutor
	) {
		return {
			inputPrompt: (
				header: string,
				placeholder?: string,
				value?: string
			) => {
				return this.inputPrompt(app, header, placeholder, value);
			},
			wideInputPrompt: (
				header: string,
				placeholder?: string,
				value?: string
			) => {
				return this.wideInputPrompt(app, header, placeholder, value);
			},
			yesNoPrompt: (header: string, text?: string) => {
				return this.yesNoPrompt(app, header, text);
			},
			infoDialog: (header: string, text: string[] | string) => {
				return this.infoDialog(app, header, text);
			},
			suggester: (
				displayItems:
					| string[]
					| ((
							value: string,
							index?: number,
							arr?: string[]
					) => string[]),
				actualItems: string[]
			) => {
				return this.suggester(app, displayItems, actualItems);
			},
			checkboxPrompt: (items: string[], selectedItems?: string[]) => {
				return this.checkboxPrompt(app, items, selectedItems);
			},
			executeChoice: async (
				choiceName: string,
				variables?: { [key: string]: any }
			) => {
				const choice: IChoice = plugin.getChoiceByName(choiceName);
				if (!choice)
					log.logError(`choice named '${choiceName}' not found`);

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
				variables?: { [key: string]: any }
			) => {
				if (variables) {
					Object.keys(variables).forEach((key) => {
						choiceExecutor.variables.set(key, variables[key]);
					});
				}

				await new CompleteFormatter(
					app,
					plugin,
					choiceExecutor
				).formatFileContent(input);
				choiceExecutor.variables.clear();
			},
			utility: {
				getClipboard: async () => {
					return await navigator.clipboard.readText();
				},
				setClipboard: async (text: string) => {
					return await navigator.clipboard.writeText(text);
				},
				getSelectedText: () => {
					const activeView =
						app.workspace.getActiveViewOfType(MarkdownView);

					if (!activeView) {
						log.logError(
							"no active view - could not get selected text."
						);
						return;
					}

					if (!activeView.editor.somethingSelected()) {
						log.logError("no text selected.");
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
		};
	}

	public static async inputPrompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string
	) {
		try {
			return await GenericInputPrompt.Prompt(
				app,
				header,
				placeholder,
				value
			);
		} catch {
			return undefined;
		}
	}

	public static async wideInputPrompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string
	) {
		try {
			return await GenericWideInputPrompt.Prompt(
				app,
				header,
				placeholder,
				value
			);
		} catch {
			return undefined;
		}
	}

	public static async yesNoPrompt(app: App, header: string, text?: string) {
		try {
			return await GenericYesNoPrompt.Prompt(app, header, text);
		} catch {
			return undefined;
		}
	}

	public static async infoDialog(app: App, header: string, text: string[] | string) {
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
		actualItems: string[]
	) {
		try {
			let displayedItems;

			if (typeof displayItems === "function") {
				displayedItems = actualItems.map(displayItems);
			} else {
				displayedItems = displayItems;
			}

			return await GenericSuggester.Suggest(
				app,
				displayedItems as string[],
				actualItems
			);
		} catch {
			return undefined;
		}
	}

	public static async checkboxPrompt(
		app: App,
		items: string[],
		selectedItems?: string[]
	) {
		try {
			return await GenericCheckboxPrompt.Open(app, items, selectedItems);
		} catch {
			return undefined;
		}
	}
}
