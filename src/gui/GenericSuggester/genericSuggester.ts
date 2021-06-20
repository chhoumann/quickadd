import {App, FuzzyMatch, FuzzySuggestModal} from "obsidian";

export default class GenericSuggester extends FuzzySuggestModal<string>{
    private resolvePromise: (value: string) => void;
    private rejectPromise: (reason?: any) => void;
    public promise: Promise<string>;
    private resolved: boolean;

    public static Suggest(app: App, displayItems: string[], items: string[]) {
        const newSuggester = new GenericSuggester(app, displayItems, items);
        return newSuggester.promise;
    }

    public constructor(app: App, private displayItems: string[], private items: string[]) {
        super(app);

        this.promise = new Promise<string>(
            (resolve, reject) => {(this.resolvePromise = resolve); (this.rejectPromise = reject)}
        );

        this.open();
    }

    getItemText(item: string): string {
        return this.displayItems[this.items.indexOf(item)];
    }

    getItems(): string[] {
        return this.items;
    }

    selectSuggestion(value: FuzzyMatch<string>, evt: MouseEvent | KeyboardEvent) {
        this.resolved = true;
        super.selectSuggestion(value, evt);
    }

    onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
        this.resolved = true;
        this.resolvePromise(item);
    }

    onClose() {
        super.onClose();

        if (!this.resolved)
            this.rejectPromise("no input given.");
    }
}