import type { App } from "obsidian";
import { SecretComponent, Setting } from "obsidian";

export function addProviderSecret(container: HTMLElement, app: App, options: {
	value: string;
	onChange: (value: string) => void;
	hasLegacyKey?: boolean;
}): Setting {
	return new Setting(container)
		.setName("API key")
		.setDesc(options.hasLegacyKey
			? "Legacy API key detected. Select a SecretStorage entry to migrate."
			: "Select a secret from SecretStorage")
		.addComponent((el) => new SecretComponent(app, el)
			.setValue(options.value)
			.onChange(options.onChange));
}
