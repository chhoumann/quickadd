import { App, Modal, Setting, TextComponent } from "obsidian";
import type { IUserScript } from "../../types/macros/IUserScript";
import QuickAdd from "../../main";
import { FormatDisplayFormatter } from "../../formatters/formatDisplayFormatter";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";

export class UserScriptSettingsModal extends Modal {
	constructor(
		app: App,
		private command: IUserScript,
		private settings: { [key: string]: any }
	) {
		super(app);

		this.display();
		if (!this.command.settings) this.command.settings = {};

		Object.keys(this.settings.options).forEach((setting) => {
			if (this.command.settings[setting] === undefined) {
				this.command.settings[setting] =
					this.settings.options[setting]?.defaultValue;
			}
		});
	}

	protected display() {
		this.containerEl.addClass("quickAddModal", "userScriptSettingsModal");
		this.contentEl.empty();

		this.titleEl.innerText = `${this.settings?.name}${
			this.settings?.author ? " by " + this.settings?.author : ""
		}`;
		const options = this.settings.options;

		Object.keys(options).forEach((option) => {
			const entry = options[option];
			let value = entry.defaultValue;

			if (this.command.settings[option] !== undefined) {
				value = this.command.settings[option];
			}

			switch (options[option]?.type?.toLowerCase()) {
				case "text":
				case "input":
					this.addInputBox(
						option,
						value,
						entry?.placeholder,
						entry?.secret
					);
					break;
				case "checkbox":
				case "toggle":
					this.addToggle(option, value);
					break;
				case "dropdown":
				case "select":
					this.addDropdown(option, entry.options, value);
					break;
				case "format":
					this.addFormatInput(option, value, entry?.placeholder);
					break;
				default:
					break;
			}
		});
	}
	private setPasswordOnBlur(el: HTMLInputElement) {
		el.addEventListener("focus", () => {
			el.type = "text";
		});

		el.addEventListener("blur", () => {
			el.type = "password";
		});

		el.type = "password";
	}

	private addInputBox(
		name: string,
		value: string,
		placeholder?: string,
		passwordOnBlur?: boolean
	) {
		new Setting(this.contentEl).setName(name).addText((input) => {
			input
				.setValue(value)
				.onChange((value) => (this.command.settings[name] = value))
				.setPlaceholder(placeholder ?? "");

			if (passwordOnBlur) {
				this.setPasswordOnBlur(input.inputEl);
			}
		});
	}

	private addToggle(name: string, value: boolean) {
		new Setting(this.contentEl)
			.setName(name)
			.addToggle((toggle) =>
				toggle
					.setValue(value)
					.onChange((value) => (this.command.settings[name] = value))
			);
	}

	private addDropdown(name: string, options: string[], value: string) {
		new Setting(this.contentEl).setName(name).addDropdown((dropdown) => {
			options.forEach((item) => dropdown.addOption(item, item));
			dropdown.setValue(value);
			dropdown.onChange((value) => (this.command.settings[name] = value));
		});
	}

	private addFormatInput(name: string, value: string, placeholder?: string) {
		new Setting(this.contentEl).setName(name);

		const formatDisplay = this.contentEl.createEl("span");
		const input = new TextComponent(this.contentEl);
		new FormatSyntaxSuggester(this.app, input.inputEl, QuickAdd.instance);
		const displayFormatter = new FormatDisplayFormatter(
			this.app,
			QuickAdd.instance
		);

		input
			.setValue(value)
			.onChange(async (value) => {
				this.command.settings[name] = value;
				formatDisplay.innerText = await displayFormatter.format(value);
			})
			.setPlaceholder(placeholder ?? "");

		input.inputEl.style.width = "100%";
		input.inputEl.style.marginBottom = "1em";

		(async () =>
			(formatDisplay.innerText = await displayFormatter.format(value)))();
	}
}
