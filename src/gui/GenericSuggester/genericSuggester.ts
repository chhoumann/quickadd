import {App, FuzzySuggestModal} from "obsidian";

export default class GenericSuggester extends FuzzySuggestModal<string>{
    private resolvePromise: (value: string) => void;
    private promise: Promise<string>;

    public static Suggest(app: App, displayItems: string[], items: string[]) {
        const newSuggester = new GenericSuggester(app, displayItems, items);
        return newSuggester.promise;
    }

    private constructor(app: App, private displayItems: string[], private items: string[]) {
        super(app);

        this.promise = new Promise<string>(
            (resolve) => (this.resolvePromise = resolve)
        );

        this.open();
    }

    getItemText(item: string): string {
        return this.displayItems[this.items.indexOf(item)];
    }

    getItems(): string[] {
        return this.items;
    }

    onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
        this.resolvePromise(item);
    }

}