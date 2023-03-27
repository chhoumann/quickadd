import { FuzzySuggestModal } from "obsidian";
import type { FuzzyMatch , App} from "obsidian";

export default class GenericSuggester extends FuzzySuggestModal<string> {
	private resolvePromise: (value: string) => void;
	private rejectPromise: (reason?: unknown) => void;
	public promise: Promise<string>;
	private resolved: boolean;

	public static Suggest(app: App, displayItems: string[], items: string[]) {
		const newSuggester = new GenericSuggester(app, displayItems, items);
		return newSuggester.promise;
	}

	public constructor(
		app: App,
		private displayItems: string[],
		private items: string[]
	) {
		super(app);

		this.promise = new Promise<string>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			// chooser is undocumented & not officially a part of the Obsidian API, hence the precautions in using it.
			if (event.code !== "Tab" || !("chooser" in this)) {
				return;
			}

			const { values, selectedItem } = this.chooser as {
				values: {
					item: string;
					match: { score: number; matches: unknown[]; };
				}[];
				selectedItem: number;
				[key: string]: unknown;
			};

			const { value } = this.inputEl;
			this.inputEl.value = values[selectedItem].item ?? value;
		});

		this.open();
	}

	getItemText(item: string): string {
		return this.displayItems[this.items.indexOf(item)];
	}

	getItems(): string[] {
		return this.items;
	}

	selectSuggestion(
		value: FuzzyMatch<string>,
		evt: MouseEvent | KeyboardEvent
	) {
		this.resolved = true;
		super.selectSuggestion(value, evt);
	}

	onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
		this.resolved = true;
		this.resolvePromise(item);
	}

	onClose() {
		super.onClose();

		if (!this.resolved) this.rejectPromise("no input given.");
	}
}
