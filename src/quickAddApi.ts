import GenericInputPrompt from "./gui/GenericInputPrompt/genericInputPrompt";
import GenericYesNoPrompt from "./gui/GenericYesNoPrompt/GenericYesNoPrompt";
import GenericSuggester from "./gui/GenericSuggester/genericSuggester";
import type {App} from "obsidian";

export class QuickAddApi {
    public static GetApi(app: App) {
        return {
            inputPrompt: (header: string, placeholder?: string, value?: string) => {return this.inputPrompt(app, header, placeholder, value)},
            yesNoPrompt: (header: string, text?: string) => {return this.yesNoPrompt(app, header, text)},
            suggester: (displayItems: string[], actualItems: string[]) => {return this.suggester(app, displayItems, actualItems)}
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

    public static async suggester(app: App, displayItems: string[], actualItems: string[]) {
        try {
            return await GenericSuggester.Suggest(app, displayItems, actualItems);
        } catch {
            return undefined;
        }
    }
}