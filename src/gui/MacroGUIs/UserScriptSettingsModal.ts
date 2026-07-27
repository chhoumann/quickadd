import type { App } from "obsidian";
import { Modal, Notice, Setting, TextAreaComponent } from "obsidian";
import type { IUserScript } from "../../types/macros/IUserScript";
import { getQuickAddInstance } from "../../quickAddInstance";
import {
	mountFormatPreview,
	type FormatPreviewHandle,
} from "../ChoiceBuilder/components/mountFormatPreview.svelte";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { setPasswordOnBlur } from "../../utils/setPasswordOnBlur";
import { initializeUserScriptSettings } from "../../utils/userScriptSettings";
import {
	clearUserScriptSecret,
	createUserScriptSecretRef,
	getSecretRefFromCommandSetting,
	isSecretUserScriptOption,
	migrateUserScriptSecretSettings,
	storeUserScriptSecret,
} from "../../utils/userScriptSecrets";

type Option = { description?: string; id?: string } & (
	| {
			type: "text" | "input";
			value: string;
			placeholder?: string;
			secret?: boolean;
			defaultValue: string;
	  }
	| {
			type: "textarea";
			value: string;
			placeholder?: string;
			defaultValue: string;
	  }
	| {
			type: "secret";
			value?: string;
			placeholder?: string;
			defaultValue?: string;
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

/**
 * The text a `type: "format"` option should render for a stored value that a
 * third-party script may have left in any shape.
 *
 * Absent means absent: `initializeUserScriptSettings` deliberately leaves an
 * option with no `defaultValue` unset so the script can apply its own, and
 * printing "undefined" into the field would be a lie about what it will receive.
 * Anything else is stringified rather than blanked, so the field agrees with the
 * value `resolveUserScriptSettings` forwards.
 */
function formatOptionText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	return String(value);
}

function formatTitlePart(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === null || value === undefined) return "";
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

export class UserScriptSettingsModal extends Modal {
	/** One per `type: "format"` option; a script may declare several. */
	private previewHandles: FormatPreviewHandle[] = [];

	constructor(
		app: App,
		private command: IUserScript,
		private settings: {
			[key: string]: unknown;
			options?: { [key: string]: Option };
		},
		private onCommandChange?: () => void,
	) {
		super(app);

		if (!this.command.settings) this.command.settings = {};

		// Initialize default values for settings
		initializeUserScriptSettings(this.command.settings, this.settings);
		this.display();
		void this.migrateSecretSettings();
	}

	protected display() {
		this.containerEl.addClass("quickAddModal", "userScriptSettingsModal");
		// Emptying contentEl does not stop a Svelte component, it only detaches it,
		// so every re-render must tear the previews down explicitly or each orphan
		// keeps a live $effect and the preview's 500ms diagnostics timer.
		this.destroyPreviews();
		this.contentEl.empty();

		const titleName = formatTitlePart(this.settings?.name ?? this.command.name);
		const author = formatTitlePart(this.settings?.author);
		this.titleEl.innerText = `${titleName}${author ? ` by ${author}` : ""}`;
		const options = this.settings.options;

		if (!options) {
			return;
		}

		// If there are options, add them to the modal
		for (const option in options) {
			if (!Object.prototype.hasOwnProperty.call(options, option)) continue;
			const entry = options[option];
			if (isSecretUserScriptOption(entry)) {
				const setting = this.addSecretInput(
					option,
					"placeholder" in entry ? entry.placeholder : undefined,
				);
				if (entry.description) {
					setting.setDesc(entry.description);
				}
				continue;
			}

			let value = entry.defaultValue;

			if (this.command.settings[option] !== undefined) {
				value = this.command.settings[option] as string | boolean;
			}

			let setting;
			const type = entry.type;
			if (type === "text" || type === "input") {
				setting = this.addInputBox(
					option,
					value as string,
					entry?.placeholder,
					entry.secret
				);
			} else if (type === "textarea") {
				setting = this.addTextArea(
					option,
					value as string,
					entry?.placeholder
				);
			} else if (type === "checkbox" || type === "toggle") {
				setting = this.addToggle(option, value as boolean);
			} else if (type === "dropdown" || type === "select") {
				setting = this.addDropdown(
					option,
					entry.options,
					value as string
				);
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
					this.onCommandChange?.();
				})
				.setPlaceholder(placeholder ?? "");

			if (passwordOnBlur) {
				setPasswordOnBlur(input.inputEl);
			}
		});
	}

	private addSecretInput(name: string, placeholder?: string) {
		const setting = new Setting(this.contentEl).setName(name);
		let pendingValue = "";
		let inputEl: HTMLInputElement | undefined;

		const hasSecret = () => {
			const value = this.command.settings?.[name];
			return (
				getSecretRefFromCommandSetting(this.command, name) !== undefined ||
				(typeof value === "string" && value.length > 0)
			);
		};
		const updatePlaceholder = () => {
			if (!inputEl) return;
			inputEl.placeholder = hasSecret()
				? "Secret saved"
				: (placeholder ?? "Paste secret");
		};

		setting.addText((input) => {
			input
				.setValue("")
				.onChange((value) => {
					pendingValue = value;
				});
			input.inputEl.type = "password";
			input.inputEl.addClass("qa-user-script-secret-input");
			input.inputEl.setAttribute("aria-label", name);
			inputEl = input.inputEl;
			updatePlaceholder();
		});

		setting.addButton((button) => {
			button.setIcon("save").setTooltip("Save secret").onClick(async () => {
				if (pendingValue.length === 0) {
					new Notice("Paste a secret before saving.");
					return;
				}

				const secretRef = await storeUserScriptSecret(
					this.app,
					this.command,
					name,
					pendingValue,
					getSecretRefFromCommandSetting(this.command, name),
					this.settings.options?.[name],
				);

				if (!secretRef) {
					new Notice("SecretStorage is unavailable. Secret was not saved.");
					return;
				}

				this.command.settings[name] = createUserScriptSecretRef(secretRef);
				pendingValue = "";
				if (inputEl) inputEl.value = "";
				updatePlaceholder();
				this.onCommandChange?.();
				new Notice("Secret saved.");
			});
			button.buttonEl.setAttribute("aria-label", `Save ${name}`);
		});

		setting.addButton((button) => {
			button.setIcon("trash-2").setTooltip("Clear secret").onClick(async () => {
				const secretRef = getSecretRefFromCommandSetting(this.command, name);
				if (secretRef) {
					const cleared = await clearUserScriptSecret(this.app, secretRef);
					if (!cleared) {
						new Notice("SecretStorage is unavailable. Secret was not cleared.");
						return;
					}
				}

				delete this.command.settings[name];
				pendingValue = "";
				if (inputEl) inputEl.value = "";
				updatePlaceholder();
				this.onCommandChange?.();
				new Notice("Secret cleared.");
			});
			button.buttonEl.setAttribute("aria-label", `Clear ${name}`);
		});

		return setting;
	}

	private addTextArea(
		name: string,
		value: string,
		placeholder?: string
	) {
		return new Setting(this.contentEl).setName(name).addTextArea((textArea) => {
			textArea
				.setValue(value)
				.onChange((value) => {
					this.command.settings[name] = value;
					this.onCommandChange?.();
				})
				.setPlaceholder(placeholder ?? "");

			textArea.inputEl.addClass("qa-user-script-argument-textarea");
		});
	}

	private addToggle(name: string, value: boolean) {
		return new Setting(this.contentEl)
			.setName(name)
			.addToggle((toggle) =>
				toggle
					.setValue(value)
					.onChange((value) => {
						this.command.settings[name] = value;
						this.onCommandChange?.();
					})
			);
	}

	private addDropdown(name: string, options: string[], value: string) {
		return new Setting(this.contentEl)
			.setName(name)
			.addDropdown((dropdown) => {
				options.forEach((item) => void dropdown.addOption(item, item));
				dropdown.setValue(value);
				dropdown.onChange((value) => {
					this.command.settings[name] = value;
					this.onCommandChange?.();
				});
			});
	}

	private addFormatInput(name: string, value: string, placeholder?: string) {
		const setting = new Setting(this.contentEl).setName(name);

		// `value` comes from a third-party script's `settings.options`, so its
		// declared `string` is a promise, not a guarantee: an option with no
		// `defaultValue` arrives as undefined (initializeUserScriptSettings
		// deliberately skips those, so the script can apply its own default), and
		// an option whose `type` changed from `toggle` to `format` between script
		// versions arrives as a boolean. Coerce here, at the boundary where
		// untrusted data enters typed code - FormatPreviewField's `value.trim()`
		// runs during mount, so a non-string would throw out of display() and out
		// of the constructor, and the gear button in the command list would
		// silently do nothing.
		//
		// A present non-string is STRINGIFIED rather than blanked, so what the
		// field shows still corresponds to what `resolveUserScriptSettings` will
		// forward to the script. That also keeps this method consistent with its
		// four siblings, which all render `value as string` unchanged. Absent
		// (undefined/null) renders empty instead of the literal text "undefined",
		// which is what a real TextAreaComponent would print.
		const text = formatOptionText(value);

		const input = new TextAreaComponent(this.contentEl);
		new FormatSyntaxSuggester(this.app, input.inputEl, getQuickAddInstance());
		input.inputEl.addClass("qa-user-script-format-textarea");
		// Appended to contentEl rather than the Setting's controlEl (it needs the
		// full modal width), so nothing associates it with the option name above.
		input.inputEl.setAttribute("aria-label", name);

		// Mounted AFTER the textarea, so the preview reads as a result of the field
		// rather than as its label - it used to be created first and rendered above
		// the input, the exact placement #1543 fixed in the choice builders.
		const preview = mountFormatPreview(this.contentEl, {
			app: this.app,
			plugin: getQuickAddInstance(),
			value: text,
		});
		this.previewHandles.push(preview);

		input
			.setValue(text)
			.onChange((value) => {
				this.command.settings[name] = value;
				preview.setValue(value);
				this.onCommandChange?.();
			})
			.setPlaceholder(placeholder ?? "");

		return setting;
	}

	/**
	 * Unmount every mounted preview.
	 *
	 * `display()` is re-entrant - the constructor calls it, and
	 * `migrateSecretSettings()` calls it again from a `void`ed promise that can
	 * land at any time - and it empties `contentEl`. Emptying the DOM does not
	 * stop a Svelte component: each orphan would keep a live `$effect` and the
	 * preview's 500ms diagnostics timer rescheduling forever.
	 */
	private destroyPreviews(): void {
		for (const handle of this.previewHandles) handle.destroy();
		this.previewHandles = [];
	}

	onClose(): void {
		this.destroyPreviews();
		super.onClose();
	}

	private async migrateSecretSettings() {
		if (
			await migrateUserScriptSecretSettings(
				this.app,
				this.command,
				this.settings,
			)
		) {
			this.onCommandChange?.();
			this.display();
		}
	}
}
