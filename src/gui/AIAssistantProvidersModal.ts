import type { App } from "obsidian";
import { ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import {
	dedupeModels,
	fetchModelsDevDirectory,
	getModelsForProvider,
	mapModelsDevToQuickAdd,
} from "src/ai/modelsDirectory";
import { ModelDirectoryModal } from "./ModelDirectoryModal";
import { setPasswordOnBlur } from "src/utils/setPasswordOnBlur";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import { ProviderPickerModal } from "./ProviderPickerModal";
import GenericYesNoPrompt from "./GenericYesNoPrompt/GenericYesNoPrompt";
import type { IconType } from "src/types/IconType";

export class AIAssistantProvidersModal extends Modal {
	public waitForClose: Promise<AIProvider[]>;

	private resolvePromise: (settings: AIProvider[]) => void;

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
					await new ProviderPickerModal(this.app, this.providers).waitForClose;
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
		this.addImportModelsFromDirectorySetting(container);
		this.addAutoSyncSetting(container);

		this.addProviderSettingButtonRow(this.contentEl);
	}

	addNameSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Name")
			.setDesc("The name of the provider")
			.addText((text) => {
				text.setValue(this.selectedProvider?.name).onChange((value) => {
					if (this.selectedProvider) {
						this.selectedProvider.name = value;
					}
				});
			});
	}

	addEndpointSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Endpoint")
			.setDesc("The endpoint for the AI Assistant")
			.addText((text) => {
				text.setValue(this.selectedProvider?.endpoint).onChange((value) => {
					if (this.selectedProvider) {
						this.selectedProvider.endpoint = value;
					}
				});
			});
	}

	addApiKeySetting(container: HTMLElement) {
		new Setting(container)
			.setName("API Key")
			.setDesc("The API Key for the AI Assistant")
			.addText((text) => {
				setPasswordOnBlur(text.inputEl);
				text.setValue(this.selectedProvider?.apiKey).onChange((value) => {
					if (this.selectedProvider) {
						this.selectedProvider.apiKey = value;
					}
				});
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

		this.selectedProvider?.models.forEach((model, i) => {
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

						this.selectedProvider?.models.splice(i, 1);
						this.reload();
					});
					button.setWarning();
					button.setIcon("trash" as IconType);
				});
		});

		new Setting(modelsContainer).setName("Add Model").addButton((button) => {
			button.setButtonText("Add Model").onClick(async () => {
				const modelName = await GenericInputPrompt.Prompt(
					this.app,
					"Model Name"
				);
				const maxTokens = await GenericInputPrompt.Prompt(
					this.app,
					"Max Tokens"
				);

				this.selectedProvider?.models.push({
					name: modelName,
					maxTokens: parseInt(maxTokens, 10),
				});

				this.reload();
			});
			button.setCta();
		});
	}

	addImportModelsFromDirectorySetting(container: HTMLElement) {
		new Setting(container)
			.setName("Import models")
			.setDesc("Browse and import models from models.dev for this provider")
			.addButton((button) => {
				button.setButtonText("Browse models").onClick(async () => {
					if (!this.selectedProvider) return;
					const res = await new ModelDirectoryModal(
						this.app,
						this.selectedProvider
					).waitForClose;
					if (!res) return;
					const { imported, mode } = res;
					if (mode === "replace") {
						this.selectedProvider.models = imported;
					} else {
						this.selectedProvider.models = dedupeModels(
							this.selectedProvider.models,
							imported
						);
					}
					new Notice(
						`Imported ${imported.length} models${mode === "replace" ? " (replaced)" : " (added)"}.`
					);
					this.reload();
				});
				button.setCta();
			});
	}

	addAutoSyncSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Auto-sync models")
			.setDesc(
				"Automatically import new models from models.dev for this provider when opening settings."
			)
			.addToggle((toggle) => {
				const current = !!this.selectedProvider?.autoSyncModels;
				toggle.setValue(current).onChange((value) => {
					if (this.selectedProvider)
						this.selectedProvider.autoSyncModels = value;
				});
			})
			.addButton((button) => {
				button.setButtonText("Sync now").onClick(async () => {
					if (!this.selectedProvider) return;
					try {
						await fetchModelsDevDirectory();
						const models = await getModelsForProvider(this.selectedProvider);
						const qaModels = mapModelsDevToQuickAdd(models);
						this.selectedProvider.models = dedupeModels(
							this.selectedProvider.models,
							qaModels
						);
						new Notice("Models synced.");
						this.reload();
					} catch (err) {
						new Notice(
							`Sync failed: ${(err as { message?: string }).message ?? err}`
						);
					}
				});
				button.setCta();
			});
	}

	addProviderSettingButtonRow(container: HTMLElement) {
		const buttonRow = container.createDiv("button-row");
		buttonRow.style.display = "flex";
		buttonRow.style.justifyContent = "space-between";
		buttonRow.style.marginTop = "20px";
		buttonRow.style.gap = "0.5rem";

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
