import type { App } from "obsidian";
import { Modal, Setting, TextAreaComponent } from "obsidian";
import type { IUserScript } from "../../types/macros/IUserScript";
import QuickAdd from "../../main";
import { FormatDisplayFormatter } from "../../formatters/formatDisplayFormatter";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { setPasswordOnBlur } from "../../utils/setPasswordOnBlur";

type Option = { description?: string } & (
	| {
			type: "text" | "input";
			value: string;
			placeholder?: string;
			secret?: boolean;
			defaultValue: string;
	  }
	| {
			type: "checkbox" | "toggle";
			value: boolean;
			defaultValue: boolean;
	  }
	| {
			type: "dropdown" | "select";
			value: string;
			options: string[];
			defaultValue: string;
	  }
	| {
			type: "format";
			value: string;
			placeholder?: string;
			defaultValue: string;
	  }
);

export class UserScriptSettingsModal extends Modal {
	constructor(
		app: App,
		private command: IUserScript,
		private settings: {
			[key: string]: unknown;
			options?: { [key: string]: Option };
		}
	) {
		super(app);

		this.display();
		if (!this.command.settings) this.command.settings = {};

		if (this.settings.options) {
			for (const setting in this.settings.options) {
				const valueIsNotSetAlready =
					this.command.settings[setting] === undefined;
				const defaultValueAvailable =
					"defaultValue" in this.settings.options[setting] &&
					this.settings.options[setting].defaultValue !== undefined;

				if (
					valueIsNotSetAlready &&
					// Checking that the setting is an object & getting the default value...
					defaultValueAvailable
				) {
					this.command.settings[setting] =
						this.settings.options[setting].defaultValue;
				}
			}
		}
	}

	protected display() {
		this.containerEl.addClass("quickAddModal", "userScriptSettingsModal");
		this.contentEl.empty();

		this.titleEl.innerText = `${this.settings?.name}${
			this.settings?.author ? ` by ${this.settings?.author}` : ""
		}`;
		const options = this.settings.options;

		if (!options) {
			return;
		}

		// If there are options, add them to the modal
		for (const option in options) {
			if (!Object.hasOwn(options, option)) continue;
			const entry = options[option];

			let value = entry.defaultValue;

			if (this.command.settings[option] !== undefined) {
				value = this.command.settings[option] as string | boolean;
			}

			let setting: Setting;
			const type = entry.type;
			if (type === "text" || type === "input") {
				setting = this.addInputBox(
					option,
					value as string,
					entry?.placeholder,
					entry.secret
				);
			} else if (type === "checkbox" || type === "toggle") {
				setting = this.addToggle(option, value as boolean);
			} else if (type === "dropdown" || type === "select") {
				setting = this.addDropdown(option, entry.options, value as string);
			} else if (type === "format") {
				setting = this.addFormatInput(
					option,
					value as string,
					entry.placeholder
				);
			}

			if (entry.description && setting) {
				setting.setDesc(entry.description);
			}
		}
	}

	private addInputBox(
		name: string,
		value: string,
		placeholder?: string,
		passwordOnBlur?: boolean
	) {
		return new Setting(this.contentEl).setName(name).addText((input) => {
			input
				.setValue(value)
				.onChange((value) => {
					this.command.settings[name] = value;
				})
				.setPlaceholder(placeholder ?? "");

			if (passwordOnBlur) {
				setPasswordOnBlur(input.inputEl);
			}
		});
	}

	private addToggle(name: string, value: boolean) {
		return new Setting(this.contentEl).setName(name).addToggle((toggle) =>
			toggle.setValue(value).onChange((value) => {
				this.command.settings[name] = value;
			})
		);
	}

	private addDropdown(name: string, options: string[], value: string) {
		return new Setting(this.contentEl).setName(name).addDropdown((dropdown) => {
			options.forEach((item) => void dropdown.addOption(item, item));
			dropdown.setValue(value);
			dropdown.onChange((value) => {
				this.command.settings[name] = value;
			});
		});
	}

	private addFormatInput(name: string, value: string, placeholder?: string) {
		const setting = new Setting(this.contentEl).setName(name);

		const formatDisplay = this.contentEl.createEl("span");
		const input = new TextAreaComponent(this.contentEl);
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
		input.inputEl.style.height = "100px";
		input.inputEl.style.marginBottom = "1em";

		void (async () => {
			formatDisplay.innerText = await displayFormatter.format(value);
		})();

		return setting;
	}
}
