import type { FuzzyMatch } from "obsidian";
import { FuzzySuggestModal, MarkdownRenderer } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import { ChoiceExecutor } from "../../choiceExecutor";
import { MultiChoice } from "../../types/choices/MultiChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type QuickAdd from "../../main";
import type { IChoiceExecutor } from "../../IChoiceExecutor";

const backLabel = "← Back";

type ChoiceSuggesterOptions = {
	choiceExecutor?: IChoiceExecutor;
	placeholder?: string;
	placeholderStack?: Array<string | undefined>;
};
export default class ChoiceSuggester extends FuzzySuggestModal<IChoice> {
	private choiceExecutor: IChoiceExecutor = new ChoiceExecutor(
		this.app,
		this.plugin
	);
	private placeholderStack: Array<string | undefined> = [];
	private currentPlaceholder?: string;

	public static Open(
		plugin: QuickAdd,
		choices: IChoice[],
		options?: ChoiceSuggesterOptions
	) {
		new ChoiceSuggester(plugin, choices, options).open();
	}

	constructor(
		private plugin: QuickAdd,
		private choices: IChoice[],
		options?: ChoiceSuggesterOptions
	) {
		super(plugin.app);
		if (options?.choiceExecutor) this.choiceExecutor = options.choiceExecutor;
		this.placeholderStack = options?.placeholderStack ?? [];
		this.currentPlaceholder = options?.placeholder?.trim() || undefined;
		if (this.currentPlaceholder) this.setPlaceholder(this.currentPlaceholder);
	}

	renderSuggestion(item: FuzzyMatch<IChoice>, el: HTMLElement): void {
		el.empty();
		void MarkdownRenderer.renderMarkdown(item.item.name, el, '', this.plugin);
		el.classList.add("quickadd-choice-suggestion");
		if (item.item.name === backLabel)
			el.classList.add("quickadd-choice-suggestion-back");
	}

	getItemText(item: IChoice): string {
		return item.name;
	}

	getItems(): IChoice[] {
		return this.choices;
	}

	async onChooseItem(
		item: IChoice,
		evt: MouseEvent | KeyboardEvent
	): Promise<void> {
		if (item.type === "Multi")
			this.onChooseMultiType(<IMultiChoice>item);
		else await this.choiceExecutor.execute(item);
	}

	private onChooseMultiType(multi: IMultiChoice) {
		const choices = [...multi.choices];
		const isBack = multi.name === backLabel;

		if (!isBack) {
			choices.push(new MultiChoice(backLabel).addChoices(this.choices));
		}

		const nextPlaceholder = isBack
			? this.placeholderStack[this.placeholderStack.length - 1]
			: multi.placeholder?.trim() || multi.name;
		const nextStack = isBack
			? this.placeholderStack.slice(0, -1)
			: [...this.placeholderStack, this.currentPlaceholder];

		ChoiceSuggester.Open(this.plugin, choices, {
			choiceExecutor: this.choiceExecutor,
			placeholder: nextPlaceholder,
			placeholderStack: nextStack,
		});
	}
}
