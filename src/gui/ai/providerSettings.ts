import type { App } from "obsidian";
import { SecretComponent, Setting } from "obsidian";

interface ProviderSecretOptions {
	value: string;
	onChange: (value: string) => void;
	hasLegacyKey?: boolean;
}

export function addProviderSecret(
	container: HTMLElement,
	app: App,
	options: ProviderSecretOptions,
): Setting {
	return configureProviderSecret(new Setting(container), app, options);
}

/** Turn `setting` into the provider's API key row. */
export function configureProviderSecret(
	setting: Setting,
	app: App,
	options: ProviderSecretOptions,
): Setting {
	return setting
		.setName("API key")
		.setDesc(options.hasLegacyKey
			? "A legacy API key is stored in plain text. Link a keychain secret to replace it."
			: "Link a secret from Settings → Keychain.")
		.addComponent((el) => new SecretComponent(app, el)
			.setValue(options.value)
			.onChange(options.onChange));
}
