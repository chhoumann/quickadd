import {App, ButtonComponent, Modal, ToggleComponent} from "obsidian";

export default class GenericCheckboxPrompt extends Modal{
    private resolvePromise: (value: string[]) => void;
    private rejectPromise: (reason?: any) => void;
    public promise: Promise<string[]>;
    private resolved: boolean;
    private _selectedItems: string[];

    public static Open(app: App, items: string[], selectedItems?: string[]) {
        const newSuggester = new GenericCheckboxPrompt(app, items, selectedItems);
        return newSuggester.promise;
    }

    public constructor(app: App, private items: string[], readonly selectedItems: string[] = []) {
        super(app);
		// This clones the item so that we don't get any unexpected modifications of the
		// arguments
        this._selectedItems = [...selectedItems];

        this.promise = new Promise<string[]>(
            (resolve, reject) => {(this.resolvePromise = resolve); (this.rejectPromise = reject)}
        );

        this.display();
        this.open();
    }

    private display() {
        this.contentEl.empty();
        this.containerEl.addClass('quickAddModal')
        this.addCheckboxRows();
        this.addSubmitButton();
    }

    onClose() {
        super.onClose();

        if (!this.resolved)
            this.rejectPromise("no input given.");
    }

    private addCheckboxRows() {
        const rowContainer: HTMLDivElement = this.contentEl.createDiv('checkboxRowContainer');
        this.items.forEach(item => this.addCheckboxRow(item, rowContainer));
    }

    private addCheckboxRow(item: string, container: HTMLDivElement) {
        const checkboxRow: HTMLDivElement = container.createDiv('checkboxRow');

        const text: HTMLSpanElement = checkboxRow.createEl('span', {text: item});
        const checkbox: ToggleComponent = new ToggleComponent(checkboxRow);
        checkbox
			.setTooltip(`Toggle ${item}`)
			.setValue(this._selectedItems.contains(item))
			.onChange(value => {
				if (value)
					this._selectedItems.push(item);
				else {
					const index = this._selectedItems.findIndex(value => item === value);
					this._selectedItems.splice(index, 1);
				}
			});
    }

    private addSubmitButton() {
        const submitButtonContainer: HTMLDivElement = this.contentEl.createDiv('submitButtonContainer');
        const submitButton: ButtonComponent = new ButtonComponent(submitButtonContainer);

        submitButton.setButtonText("Submit").setCta().onClick(evt => {
           this.resolved = true;
           this.resolvePromise(this._selectedItems);

           this.close();
        });
    }
}
