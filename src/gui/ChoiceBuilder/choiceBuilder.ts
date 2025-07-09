import type { App, Setting } from "obsidian";
import { Modal } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type { SvelteComponent } from "svelte";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { log } from "../../logger/logManager";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";

export abstract class ChoiceBuilder extends Modal {
	private resolvePromise: (input: IChoice) => void;
	private rejectPromise: (reason?: unknown) => void;
	private input: IChoice;
	public waitForClose: Promise<IChoice>;
	abstract choice: IChoice;
	private didSubmit = false;
	protected svelteElements: SvelteComponent[] = [];

	protected constructor(app: App) {
		super(app);

		this.waitForClose = new Promise<IChoice>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.containerEl.addClass("quickAddModal");
		this.open();
	}

	protected abstract display(): unknown;

	protected reload() {
		this.contentEl.empty();
		this.display();
	}

	protected addFileSearchInputToSetting(
		setting: Setting,
		value: string,
		onChangeCallback: (value: string) => void
	): void {
		setting.addSearch((searchComponent) => {
			searchComponent.setValue(value);
			searchComponent.setPlaceholder("File path");

			const markdownFiles: string[] = this.app.vault
				.getMarkdownFiles()
				.map((f) => f.path);
			new GenericTextSuggester(
				this.app,
				searchComponent.inputEl,
				markdownFiles
			);

			searchComponent.onChange(onChangeCallback);
		});

		return;
	}

	protected addCenteredChoiceNameHeader(choice: IChoice): void {
		const headerEl: HTMLHeadingElement = this.contentEl.createEl("h2", {
			cls: "choiceNameHeader",
		});
		headerEl.setText(choice.name);

		 
		headerEl.addEventListener("click", async (ev) => {
			try {
				const newName: string = await GenericInputPrompt.Prompt(
					this.app,
					choice.name,
					"Choice name",
					choice.name
				);
				if (newName !== choice.name) {
					choice.name = newName;
					headerEl.setText(newName);
				}
			} catch {
				log.logMessage(`No new name given for ${choice.name}`);
			}
		});
	}

	onClose() {
		super.onClose();
		this.resolvePromise(this.choice);
		this.svelteElements.forEach((el) => {
			if (el && el.$destroy) el.$destroy();
		});

		if (!this.didSubmit) this.rejectPromise("No answer given.");
		else this.resolvePromise(this.input);
	}
}
