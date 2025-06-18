/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { App } from "obsidian";
import { ButtonComponent, Modal, Setting } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { setPasswordOnBlur } from "src/utils/setPasswordOnBlur";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import GenericYesNoPrompt from "./GenericYesNoPrompt/GenericYesNoPrompt";
import type { IconType } from "src/types/IconType";

export class AIAssistantProvidersModal extends Modal {
	public waitForClose: Promise<AIProvider[]>;

	private resolvePromise: (settings: AIProvider[]) => void;
	private rejectPromise: (reason?: unknown) => void;

	private providers: AIProvider[];
	private selectedProvider: AIProvider | null;

	private _selectedProviderClone: AIProvider | null;

	constructor(providers: AIProvider[], app: App) {
		super(app);

		this.providers = providers;

		this.waitForClose = new Promise<AIProvider[]>((resolve, reject) => {
			this.rejectPromise = reject;
			this.resolvePromise = resolve;
		});

		this.open();
		this.display();
	}

	private display(): void {
		const modalName = this.selectedProvider
			? `${this.selectedProvider.name}`
			: "Providers";

		this.contentEl.createEl("h2", {
			text: modalName,
		}).style.textAlign = "center";

		if (this.selectedProvider) {
			this.addProviderSetting(this.contentEl);

			return;
		}

		this.addProvidersSetting(this.contentEl);
	}

	private reload(): void {
		this.contentEl.empty();

		this.display();
	}

	addProvidersSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Providers")
			.setDesc("Providers for the AI Assistant")
			.addButton((button) => {
				button.setButtonText("Add Provider").onClick(async () => {
					const providerName = await GenericInputPrompt.Prompt(
						this.app,
						"Provider Name"
					);

					this.providers.push({
						name: providerName,
						endpoint: "",
						apiKey: "",
						models: [],
					});

					this.reload();
				});

				button.setCta();
			});

		const providersContainer = container.createDiv("providers-container");
		providersContainer.style.display = "flex";
		providersContainer.style.flexDirection = "column";
		providersContainer.style.gap = "10px";
		providersContainer.style.overflowY = "auto";
		providersContainer.style.maxHeight = "400px";
		providersContainer.style.padding = "10px";

		this.providers.forEach((provider, i) => {
			new Setting(providersContainer)
				.setName(provider.name)
				.setDesc(provider.endpoint)
				.addButton((button) => {
					button.onClick(async () => {
						const confirmation = await GenericYesNoPrompt.Prompt(
							this.app,
							`Are you sure you want to delete ${provider.name}?`
						);
						if (!confirmation) {
							return;
						}

						this.providers.splice(i, 1);
						this.reload();
					});
					button.setWarning();
					button.setIcon("trash" as IconType);
				})
				.addButton((button) => {
					button.setButtonText("Edit").onClick(() => {
						this.selectedProvider = provider;
						this._selectedProviderClone = structuredClone(provider);

						this.reload();
					});
				});
		});
	}

	addProviderSetting(container: HTMLElement) {
		this.addNameSetting(container);
		this.addEndpointSetting(container);
		this.addApiKeySetting(container);
 
        this.addProviderModelsSetting(container);

		this.addProviderSettingButtonRow(this.contentEl);
	}

	addNameSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Name")
			.setDesc("The name of the provider")
			.addText((text) => {
				text.setValue(this.selectedProvider!.name).onChange((value) => {
					this.selectedProvider!.name = value;
				});
			});
	}

	addEndpointSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Endpoint")
			.setDesc("The endpoint for the AI Assistant")
			.addText((text) => {
				text.setValue(this.selectedProvider!.endpoint).onChange(
					(value) => {
						this.selectedProvider!.endpoint = value;
					}
				);
			});
	}

	addApiKeySetting(container: HTMLElement) {
		new Setting(container)
			.setName("API Key")
			.setDesc("The API Key for the AI Assistant")
			.addText((text) => {
				setPasswordOnBlur(text.inputEl);
				text.setValue(this.selectedProvider!.apiKey).onChange(
					(value) => {
						this.selectedProvider!.apiKey = value;
					}
				);
			});
	}

    addProviderModelsSetting(container: HTMLElement) {
        const modelsContainer = container.createDiv("models-container");
        modelsContainer.style.display = "flex";
        modelsContainer.style.flexDirection = "column";
        modelsContainer.style.gap = "10px";
        modelsContainer.style.overflowY = "auto";
        modelsContainer.style.maxHeight = "400px";
        modelsContainer.style.padding = "10px";

        this.selectedProvider!.models.forEach((model, i) => {
            new Setting(modelsContainer)
                .setName(model.name)
                .setDesc(`Max Tokens: ${model.maxTokens}`)
                .addButton((button) => {
                    button.onClick(async () => {
                        const confirmation = await GenericYesNoPrompt.Prompt(
                            this.app,
                            `Are you sure you want to delete ${model.name}?`
                        );
                        if (!confirmation) {
                            return;
                        }

                        this.selectedProvider!.models.splice(i, 1);
                        this.reload();
                    });
                    button.setWarning();
                    button.setIcon("trash" as IconType);
                });
        });

        new Setting(modelsContainer)
            .setName("Add Model")
            .addButton((button) => {
                button.setButtonText("Add Model").onClick(async () => {
                    const modelName = await GenericInputPrompt.Prompt(
                        this.app,
                        "Model Name"
                    );
                    const maxTokens = await GenericInputPrompt.Prompt(
                        this.app,
                        "Max Tokens"
                    );

                    this.selectedProvider!.models.push({
                        name: modelName,
                        maxTokens: parseInt(maxTokens),
                    });

                    this.reload();
                });
                button.setCta();
            });
    }

	addProviderSettingButtonRow(container: HTMLElement) {
		const buttonRow = container.createDiv("button-row");
		buttonRow.style.display = "flex";
		buttonRow.style.justifyContent = "space-between";
		buttonRow.style.marginTop = "20px";

		const CancelButton = new ButtonComponent(buttonRow);
		CancelButton.setButtonText("Cancel");
		CancelButton.setWarning();
		CancelButton.onClick(() => {
			if (!this.selectedProvider || !this._selectedProviderClone) return;
			const noChangesMade = !checkObjectDiff(
				this.selectedProvider,
				this._selectedProviderClone
			);

			if (noChangesMade) {
				this.selectedProvider = null;
				this._selectedProviderClone = null;

				this.reload();
				return;
			}

			Object.assign(this.selectedProvider, this._selectedProviderClone);
			this.selectedProvider = this._selectedProviderClone;
			this._selectedProviderClone = null;

			this.close();
		});

		const SaveButton = new ButtonComponent(buttonRow);
		SaveButton.setButtonText("Save");
		SaveButton.setCta();
		SaveButton.onClick(() => {
			this.selectedProvider = null;
			this.reload();
		});
	}

	onClose(): void {
		if (this.selectedProvider) {
			// go back to main view
			this.selectedProvider = null;
			this.reload();
			this.open();
		}

		this.resolvePromise(this.providers);
		super.onClose();
	}
}

function checkObjectDiff(obj1: unknown, obj2: unknown) {
	return JSON.stringify(obj1) !== JSON.stringify(obj2);
}
