import type { App } from "obsidian";
import GenericInputPrompt from "../gui/GenericInputPrompt/GenericInputPrompt";
import GenericWideInputPrompt from "../gui/GenericWideInputPrompt/GenericWideInputPrompt";
import GenericYesNoPrompt from "../gui/GenericYesNoPrompt/GenericYesNoPrompt";
import GenericInfoDialog from "../gui/GenericInfoDialog/GenericInfoDialog";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import GenericCheckboxPrompt from "../gui/GenericCheckboxPrompt/genericCheckboxPrompt";
import InputSuggester from "../gui/InputSuggester/inputSuggester";
import VDateInputPrompt from "../gui/VDateInputPrompt/VDateInputPrompt";
import { normalizeDisplayItem } from "../gui/suggesters/utils";
import { MacroAbortError } from "../errors/MacroAbortError";
import { UserCancelError, PROMPT_CANCELLED_MESSAGE } from "../errors/UserCancelError";
import { isCancellationError } from "../utils/errorUtils";
import { formatISODate } from "../utils/dateParser";
import type { InputPromptOptions } from "../types/inputPrompt";

export class PromptApi {
	public static async inputPrompt(
		this: void,
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
				// API prompts open over the editor, so peek is on by default;
				// a caller can still pass allowPeek: false.
				{ allowPeek: true, ...options },
			);
		} catch (error) {
			rethrowPromptError(error);
		}
	}

	public static async datePrompt(
		this: void,
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
			rethrowPromptError(error);
		}
	}

	public static async wideInputPrompt(
		this: void,
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
				{ allowPeek: true, ...options },
			);
		} catch (error) {
			rethrowPromptError(error);
		}
	}

	public static async yesNoPrompt(this: void, app: App, header: string, text?: string) {
		// Scripts are the one caller that must tell "No" from "the user walked
		// away": answering No returns false and the script carries on, while
		// dismissing the dialog aborts the macro like every other prompt does.
		let answer: boolean | null;
		try {
			answer = await GenericYesNoPrompt.Ask(app, header, text);
		} catch (error) {
			rethrowPromptError(error);
		}

		if (answer === null) throw new UserCancelError(PROMPT_CANCELLED_MESSAGE);
		return answer;
	}

	public static async infoDialog(
		this: void,
		app: App,
		header: string,
		text: string[] | string,
	) {
		try {
			return await GenericInfoDialog.Show(app, header, text);
		} catch (error) {
			rethrowPromptError(error);
		}
	}

	public static async suggester(
		this: void,
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
			rethrowPromptError(error);
		}
	}

	public static async checkboxPrompt(
		this: void,
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
			rethrowPromptError(error);
		}
	}
}

export function rethrowPromptError(error: unknown): never {
	if (error instanceof MacroAbortError) {
		throw error;
	}
	if (isCancellationError(error)) {
		throw new UserCancelError(PROMPT_CANCELLED_MESSAGE);
	}
	throw error;
}
