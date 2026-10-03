import type { App } from "obsidian";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { addChoiceIconSetting } from "./ChoiceBuilder/components/choiceIconSetting";
import { BuilderPage, nameOrFallback } from "./ChoiceBuilder/builderPage";

/** A folder's settings, as a page of Settings → QuickAdd. */
export class MultiChoiceBuilder extends BuilderPage<IMultiChoice> {
	private name: string;
	private placeholder: string;
	private icon: string | undefined;

	constructor(
		app: App,
		private readonly choice: IMultiChoice,
		onSave: (choice: IMultiChoice) => void,
	) {
		super(app, choice.name, onSave);
		this.name = choice.name;
		this.placeholder = choice.placeholder ?? "";
		this.icon = typeof choice.icon === "string" ? choice.icon : undefined;
		this.containerEl.addClass("qaMultiChoiceBuilder");
	}

	protected render(containerEl: HTMLElement): void {
		let setPlaceholderHint = (_hint: string): void => {};
		const group = this.addNameSetting(containerEl, this.name, this.choice.name, (name) => {
			this.name = name;
			setPlaceholderHint(name.trim() || this.choice.name);
		});
		group.addSetting((setting) => {
			setting
				.setName("Placeholder")
				.setDesc(
					"Shown in the choice picker search box when this folder opens. Leave blank to use the folder name.",
				)
				.addText((text) => {
					setPlaceholderHint = (hint) => {
						text.setPlaceholder(hint);
					};
					text.setPlaceholder(this.name);
					text.setValue(this.placeholder).onChange((value) => {
						this.placeholder = value;
					});
				});
		});
		addChoiceIconSetting(
			this.app,
			group.listEl,
			{ type: this.choice.type, icon: this.icon },
			(icon) => {
				this.icon = icon;
			},
		);
	}

	protected result(): IMultiChoice {
		const placeholder = this.placeholder.trim();
		return {
			...this.choice,
			name: nameOrFallback(this.name, this.choice.name),
			placeholder: placeholder ? placeholder : undefined,
			icon: this.icon,
		};
	}
}
