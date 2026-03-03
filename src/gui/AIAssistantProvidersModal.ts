import type { App } from "obsidian";
import { Modal, Notice, SecretComponent, Setting } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { dedupeModels } from "src/ai/modelsDirectory";
import { discoverProviderModels } from "src/ai/modelDiscoveryService";
import { resolveProviderApiKey } from "src/ai/providerSecrets";
import { createDraftSession, type DraftSession } from "src/state/createDraftSession";
import type { IconType } from "src/types/IconType";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import GenericYesNoPrompt from "./GenericYesNoPrompt/GenericYesNoPrompt";
import { ModelDirectoryModal } from "./ModelDirectoryModal";
import { ProviderPickerModal } from "./ProviderPickerModal";
import { renderModalActionBar } from "./MacroGUIs/modalActionBar";
import { withPreservedUiContext } from "./ui/preserveUiContext";

export class AIAssistantProvidersModal extends Modal {
	public waitForClose: Promise<AIProvider[]>;

	private resolvePromise!: (settings: AIProvider[]) => void;
	private providers: AIProvider[];
	private selectedProviderIndex: number | null = null;
	private selectedProviderSession: DraftSession<AIProvider> | null = null;

	constructor(providers: AIProvider[], app: App) {
		super(app);
		this.providers = providers;

		this.waitForClose = new Promise<AIProvider[]>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.open();
		this.display();
	}

	private get selectedProvider(): AIProvider | null {
		return this.selectedProviderSession?.draft ?? null;
	}

	private beginProviderEdit(index: number): void {
		const provider = this.providers[index];
		if (!provider) return;
		this.selectedProviderIndex = index;
		this.selectedProviderSession = createDraftSession(provider);
	}

	private cancelProviderEdit(): void {
		this.selectedProviderSession = null;
		this.selectedProviderIndex = null;
	}

	private commitProviderEdit(): void {
		if (this.selectedProviderIndex === null || !this.selectedProviderSession) {
			return;
		}
		this.providers[this.selectedProviderIndex] = this.selectedProviderSession.commit();
		this.cancelProviderEdit();
	}

	private display(): void {
		const modalName = this.selectedProvider
			? this.selectedProvider.name
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
		withPreservedUiContext(this.contentEl, () => {
			this.contentEl.empty();
			this.display();
		});
	}

	private addProvidersSetting(container: HTMLElement) {
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

		this.providers.forEach((provider, index) => {
			new Setting(providersContainer)
				.setName(provider.name)
				.setDesc(provider.endpoint)
				.addButton((button) => {
					button.onClick(async () => {
						const confirmed = await GenericYesNoPrompt.Prompt(
							this.app,
							`Are you sure you want to delete ${provider.name}?`,
						);
						if (!confirmed) return;
						this.providers.splice(index, 1);
						this.reload();
					});
					button.setWarning();
					button.setIcon("trash" as IconType);
				})
				.addButton((button) => {
					button.setButtonText("Edit").onClick(() => {
						this.beginProviderEdit(index);
						this.reload();
					});
				});
		});
	}

	private addProviderSetting(container: HTMLElement) {
		this.addNameSetting(container);
		this.addEndpointSetting(container);
		this.addApiKeySetting(container);
		this.addModelSourceSetting(container);
		this.addProviderModelsSetting(container);
		this.addImportModelsFromDirectorySetting(container);
		this.addAutoSyncSetting(container);
		this.addProviderSettingButtonRow(container);
	}

	private addNameSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Name")
			.setDesc("The name of the provider")
			.addText((text) => {
				text.setValue(this.selectedProvider?.name ?? "").onChange((value) => {
					if (!this.selectedProvider) return;
					this.selectedProvider.name = value;
				});
			});
	}

	private addEndpointSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Endpoint")
			.setDesc("The endpoint for the AI Assistant")
			.addText((text) => {
				text
					.setValue(this.selectedProvider?.endpoint ?? "")
					.onChange((value) => {
						if (!this.selectedProvider) return;
						this.selectedProvider.endpoint = value;
					});
			});
	}

	private addApiKeySetting(container: HTMLElement) {
		const provider = this.selectedProvider;
		if (!provider) return;

		const hasLegacyKey = !!provider.apiKey && !provider.apiKeyRef;
		const description = hasLegacyKey
			? "Legacy API key detected. Select a SecretStorage entry to migrate."
			: "Select a secret from SecretStorage";

		new Setting(container)
			.setName("API Key")
			.setDesc(description)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(provider.apiKeyRef ?? "")
					.onChange((value) => {
						if (!this.selectedProvider) return;
						this.selectedProvider.apiKeyRef = value;
						this.selectedProvider.apiKey = "";
					}),
			);
	}

	private addModelSourceSetting(container: HTMLElement) {
		const provider = this.selectedProvider;
		if (!provider) return;

		new Setting(container)
			.setName("Model source")
			.setDesc(
				"Choose where QuickAdd looks when browsing or syncing models for this provider.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption(
					"providerApi",
					"Provider /v1/models (requires API key)",
				);
				dropdown.addOption("modelsDev", "models.dev directory");
				dropdown.addOption(
					"auto",
					"Automatic (try provider, fallback to models.dev)",
				);
				dropdown.setValue(provider.modelSource ?? "providerApi");
				dropdown.onChange((value) => {
					if (!this.selectedProvider) return;
					this.selectedProvider.modelSource = value as AIProvider["modelSource"];
					this.reload();
				});
			});
	}

	private addProviderModelsSetting(container: HTMLElement) {
		const provider = this.selectedProvider;
		if (!provider) return;

		const modelsContainer = container.createDiv("models-container");
		modelsContainer.style.display = "flex";
		modelsContainer.style.flexDirection = "column";
		modelsContainer.style.gap = "10px";
		modelsContainer.style.overflowY = "auto";
		modelsContainer.style.maxHeight = "400px";
		modelsContainer.style.padding = "10px";

		provider.models.forEach((model, index) => {
			new Setting(modelsContainer)
				.setName(model.name)
				.setDesc(`Max Tokens: ${model.maxTokens}`)
				.addButton((button) => {
					button.onClick(async () => {
						const confirmed = await GenericYesNoPrompt.Prompt(
							this.app,
							`Are you sure you want to delete ${model.name}?`,
						);
						if (!confirmed || !this.selectedProvider) return;
						this.selectedProvider.models.splice(index, 1);
						this.reload();
					});
					button.setWarning();
					button.setIcon("trash" as IconType);
				});
		});

		new Setting(modelsContainer).setName("Add Model").addButton((button) => {
			button.setButtonText("Add Model").onClick(async () => {
				if (!this.selectedProvider) return;
				const modelName = await GenericInputPrompt.Prompt(this.app, "Model Name");
				const maxTokens = await GenericInputPrompt.Prompt(this.app, "Max Tokens");

				this.selectedProvider.models.push({
					name: modelName,
					maxTokens: Number.parseInt(maxTokens, 10),
				});
				this.reload();
			});
			button.setCta();
		});
	}

	private addImportModelsFromDirectorySetting(container: HTMLElement) {
		const provider = this.selectedProvider;
		if (!provider) return;

		const sourceDescription = this.describeModelSource(provider);
		new Setting(container)
			.setName("Import models")
			.setDesc(`Browse and import models from ${sourceDescription}.`)
			.addButton((button) => {
				button.setButtonText("Browse models").onClick(async () => {
					if (!this.selectedProvider) return;
					const result = await new ModelDirectoryModal(
						this.app,
						this.selectedProvider,
					).waitForClose;
					if (!result) return;

					const { imported, mode } = result;
					if (mode === "replace") {
						this.selectedProvider.models = imported;
					} else {
						this.selectedProvider.models = dedupeModels(
							this.selectedProvider.models,
							imported,
						);
					}

					new Notice(
						`Imported ${imported.length} models${
							mode === "replace" ? " (replaced)" : " (added)"
						}.`,
					);
					this.reload();
				});
				button.setCta();
			});
	}

	private addAutoSyncSetting(container: HTMLElement) {
		const provider = this.selectedProvider;
		if (!provider) return;

		const sourceDescription = this.describeModelSource(provider);
		new Setting(container)
			.setName("Auto-sync models")
			.setDesc(
				`Automatically import new models from ${sourceDescription} when opening settings.`,
			)
			.addToggle((toggle) => {
				toggle.setValue(!!provider.autoSyncModels).onChange((value) => {
					if (!this.selectedProvider) return;
					this.selectedProvider.autoSyncModels = value;
				});
			})
			.addButton((button) => {
				button.setButtonText("Sync now").onClick(async () => {
					if (!this.selectedProvider) return;
					try {
						const apiKey = await resolveProviderApiKey(
							this.app,
							this.selectedProvider,
						);
						const models = await discoverProviderModels(
							this.selectedProvider,
							apiKey,
						);
						this.selectedProvider.models = dedupeModels(
							this.selectedProvider.models,
							models,
						);
						new Notice(`Models synced from ${sourceDescription}.`);
						this.reload();
					} catch (err) {
						const message =
							err instanceof Error ? err.message : String(err);
						new Notice(`Sync failed: ${message}`);
					}
				});
				button.setCta();
			});
	}

	private addProviderSettingButtonRow(container: HTMLElement) {
		renderModalActionBar({
			parent: container,
			justifyContent: "space-between",
			gapPx: 8,
			cancelWarning: true,
			onCancel: () => {
				this.cancelProviderEdit();
				this.reload();
			},
			onSave: () => {
				this.commitProviderEdit();
				this.reload();
			},
		});
	}

	private describeModelSource(provider: AIProvider): string {
		const mode = provider.modelSource ?? "providerApi";
		switch (mode) {
			case "modelsDev":
				return "the models.dev directory";
			case "auto":
				return "the provider's /v1/models endpoint (falls back to models.dev)";
			default:
				return "the provider's /v1/models endpoint";
		}
	}

	onClose(): void {
		if (this.selectedProviderSession) {
			this.cancelProviderEdit();
			this.reload();
			this.open();
			return;
		}

		this.resolvePromise(this.providers);
		super.onClose();
	}
}
