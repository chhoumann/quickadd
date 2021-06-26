import GenericInputPrompt from "./gui/GenericInputPrompt/genericInputPrompt";
import GenericYesNoPrompt from "./gui/GenericYesNoPrompt/GenericYesNoPrompt";
import GenericSuggester from "./gui/GenericSuggester/genericSuggester";
import type {App} from "obsidian";
import GenericCheckboxPrompt from "./gui/GenericCheckboxPrompt/genericCheckboxPrompt";

export class QuickAddApi {
    public static GetApi(app: App) {
        return {
            inputPrompt: (header: string, placeholder?: string, value?: string) => {return this.inputPrompt(app, header, placeholder, value)},
            yesNoPrompt: (header: string, text?: string) => {return this.yesNoPrompt(app, header, text)},
            suggester: (displayItems: string[] | ((value: string, index?: number, arr?: string[]) => string[]), actualItems: string[]) => {return this.suggester(app, displayItems, actualItems)},
            checkboxPrompt: (items: string[], selectedItems?: string[]) => {return this.checkboxPrompt(app, items, selectedItems)}
        };
    }

    public static async inputPrompt(app: App, header: string, placeholder?: string, value?: string) {
        try {
            return await GenericInputPrompt.Prompt(app, header, placeholder, value);
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

    public static async suggester(app: App, displayItems: string[] | ((value: string, index?: number, arr?: string[]) => string[]), actualItems: string[]) {
        try {
            let displayedItems;

            if (typeof displayItems === "function") {
                displayedItems = actualItems.map(displayItems);
            } else {
                displayedItems = displayItems;
            }

            return await GenericSuggester.Suggest(app, displayedItems, actualItems);
        } catch {
            return undefined;
        }
    }

    public static async checkboxPrompt(app: App, items: string[], selectedItems?: string[]) {
        try {
            return await GenericCheckboxPrompt.Open(app, items, selectedItems);
        } catch {
            return undefined;
        }
    }
}