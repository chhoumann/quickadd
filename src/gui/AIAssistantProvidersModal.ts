 
import type { App } from "obsidian";
import { ButtonComponent, Modal, Notice, SecretComponent, Setting } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { ensureProviderIds } from "src/ai/Provider";
import { mergeModels } from "src/ai/modelsDirectory";
import { syncProviderModels } from "src/ai/modelSyncService";
import { settingsStore } from "src/settingsStore";
import { ModelDirectoryModal } from "./ModelDirectoryModal";
import { deepClone } from "src/utils/deepClone";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import { ProviderPickerModal } from "./ProviderPickerModal";
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
		// Providers from hand-edited data.json may lack the stable id that
		// pinned model refs and the qualified script syntax rely on.
		ensureProviderIds(this.providers);

		this.waitForClose = new Promise<AIProvider[]>((resolve, reject) => {
			this.rejectPromise = reject;
			this.resolvePromise = resolve;
		});

		this.open();
		this.display();
		void this.autoSyncOnOpen();
	}

	/**
	 * Quiet refresh of every auto-sync provider when the settings open, so the
	 * lists a user is about to browse are current. Failures stay silent here —
	 * the explicit "Sync now" button is the loud path.
	 */
	private async autoSyncOnOpen(): Promise<void> {
		if (settingsStore.getState().disableOnlineFeatures) return;

		let changed = false;
		for (const provider of this.providers) {
			if (!provider.autoSyncModels) continue;
			try {
				const { added } = await syncProviderModels(this.app, provider);
				changed = changed || added > 0;
			} catch {
				// Quiet by design; "Sync now" surfaces errors.
			}
		}

		// Refresh whatever view is showing, but never clobber in-progress edits.
		if (changed && !this.selectedProvider) this.reload();
	}

	private display(): void {
		const modalName = this.selectedProvider
			? `${this.selectedProvider.name}`
			: "Providers";

		this.contentEl.createEl("h2", {
			text: modalName,
			cls: "qa-modal-title",
		});

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

		const providersContainer = container.createDiv({
			cls: "providers-container qa-ai-list-container",
		});

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
					button.setDestructive();
					button.setIcon("trash" as IconType);
				})
					.addButton((button) => {
						button.setButtonText("Edit").onClick(() => {
							this.selectedProvider = provider;
							this._selectedProviderClone = deepClone(provider);

							this.reload();
						});
					});
		});
	}

	addProviderSetting(container: HTMLElement) {
		this.addNameSetting(container);
		this.addEndpointSetting(container);
		this.addApiKeySetting(container);
		this.addKindSetting(container);
		this.addModelSourceSetting(container);

		this.addProviderModelsSetting(container);
		this.addImportModelsFromDirectorySetting(container);
		this.addAutoSyncSetting(container);

		this.addProviderSettingButtonRow(this.contentEl);
	}

	addNameSetting(container: HTMLElement) {
		const providerId = this.selectedProvider!.id;
		new Setting(container)
			.setName("Name")
			.setDesc(
				providerId
					? `The display name of the provider. Its stable ID is "${providerId}" — use that to qualify models in scripts, e.g. ai.prompt with "${providerId}/model-name".`
					: "The display name of the provider",
			)
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
		const hasLegacyKey =
			!!this.selectedProvider?.apiKey && !this.selectedProvider?.apiKeyRef;
		const description = hasLegacyKey
			? "Legacy API key detected. Select a SecretStorage entry to migrate."
			: "Select a secret from SecretStorage";

		new Setting(container)
			.setName("API Key")
			.setDesc(description)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.selectedProvider?.apiKeyRef ?? "")
					.onChange((value) => {
						if (!this.selectedProvider) return;
						this.selectedProvider.apiKeyRef = value;
						this.selectedProvider.apiKey = "";
					}),
			);
	}

	addKindSetting(container: HTMLElement) {
		new Setting(container)
			.setName("Provider type")
			.setDesc(
				"The request format this provider expects. Auto-detect recognizes the official Anthropic and Gemini endpoints and treats everything else as OpenAI-compatible; pick a type explicitly for a proxy or custom endpoint.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("", "Auto-detect");
				dropdown.addOption("openai", "OpenAI-compatible");
				dropdown.addOption("anthropic", "Anthropic");
				dropdown.addOption("gemini", "Gemini");
				dropdown.setValue(this.selectedProvider?.kind ?? "");
				dropdown.onChange((value) => {
					if (!this.selectedProvider) return;
					this.selectedProvider.kind = value
						? (value as AIProvider["kind"])
						: undefined;
				});
			});
	}

	addModelSourceSetting(container: HTMLElement) {
		const provider = this.selectedProvider;
		new Setting(container)
			.setName("Model source")
			.setDesc(
				"Choose where QuickAdd looks when browsing or syncing models for this provider.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption(
					"providerApi",
					"Provider models endpoint (requires API key)",
				);
				dropdown.addOption("modelsDev", "models.dev directory");
				dropdown.addOption(
					"auto",
					"Automatic (try provider, fallback to models.dev)",
				);
				const current = provider?.modelSource ?? "providerApi";
				dropdown.setValue(current);
				dropdown.onChange((value) => {
					if (!this.selectedProvider) return;
					this.selectedProvider.modelSource = value as AIProvider["modelSource"];
					this.reload();
				});
			});
	}

    addProviderModelsSetting(container: HTMLElement) {
        const modelsContainer = container.createDiv({
			cls: "models-container qa-ai-list-container",
		});

        this.selectedProvider!.models.forEach((model, i) => {
            const metadata = [`Context: ${model.maxTokens.toLocaleString()} tokens`];
            if (model.maxOutputTokens) {
                metadata.push(`Output: ${model.maxOutputTokens.toLocaleString()} tokens`);
            }
            if (model.supportsTemperature === false) {
                metadata.push("Fixed sampling (no temperature)");
            }
            new Setting(modelsContainer)
                .setName(model.name)
                .setDesc(metadata.join(" · "))
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
                    button.setDestructive();
                    button.setIcon("trash" as IconType);
                });
        });

        new Setting(modelsContainer)
            .setName("Add Model")
            .addButton((button) => {
                button.setButtonText("Add Model").onClick(async () => {
                    let modelName: string;
                    let maxTokens: string;
                    try {
                        modelName = await GenericInputPrompt.Prompt(
                            this.app,
                            "Model Name"
                        );
                        maxTokens = await GenericInputPrompt.Prompt(
                            this.app,
                            "Max Tokens"
                        );
                    } catch {
                        // Cancelling either prompt is a clean no-op.
                        return;
                    }

                    const trimmedName = modelName.trim();
                    if (!trimmedName) {
                        new Notice("Model name cannot be empty.");
                        return;
                    }

                    // Reject non-numeric input outright: parseInt would silently
                    // accept "10abc" as 10. Require a plain positive integer.
                    const normalizedMaxTokens = maxTokens.trim();
                    if (!/^[1-9]\d*$/.test(normalizedMaxTokens)) {
                        new Notice("Max tokens must be a positive number.");
                        return;
                    }
                    const parsedMaxTokens = Number(normalizedMaxTokens);

                    this.selectedProvider!.models.push({
                        name: trimmedName,
                        maxTokens: parsedMaxTokens,
                    });

                    this.reload();
                });
                button.setCta();
            });
    }

	addImportModelsFromDirectorySetting(container: HTMLElement) {
		const sourceDescription = this.describeModelSource(this.selectedProvider);
		new Setting(container)
			.setName("Import models")
			.setDesc(`Browse and import models from ${sourceDescription}.`)
			.addButton((button) => {
				button.setButtonText("Browse models").onClick(async () => {
					const res = await new ModelDirectoryModal(this.app, this.selectedProvider!).waitForClose;
                    if (!res) return;
                    const { imported, mode } = res;
                    if (mode === "replace") {
                        this.selectedProvider!.models = imported;
                    } else {
                        // Merge (not append-only dedupe): re-importing a model the
                        // provider already has refreshes its context/output metadata.
                        this.selectedProvider!.models = mergeModels(
                            this.selectedProvider!.models,
                            imported
                        );
                    }
                    new Notice(`Imported ${imported.length} models${mode === "replace" ? " (replaced)" : " (added)"}.`);
                    this.reload();
                });
                button.setCta();
            });
    }

	addAutoSyncSetting(container: HTMLElement) {
		const sourceDescription = this.describeModelSource(this.selectedProvider);
		new Setting(container)
			.setName("Auto-sync models")
			.setDesc(
				`Keep this provider's models current automatically: QuickAdd imports new models and refreshed context limits from ${sourceDescription} once a day and when these settings open.`,
			)
			.addToggle((toggle) => {
				const current = !!this.selectedProvider?.autoSyncModels;
				toggle.setValue(current).onChange((value) => {
					if (this.selectedProvider) this.selectedProvider.autoSyncModels = value;
				});
			})
			.addButton((button) => {
				button.setButtonText("Sync now").onClick(async () => {
					try {
						const { added, updated } = await syncProviderModels(
							this.app,
							this.selectedProvider!,
						);
						new Notice(
							added > 0 || updated > 0
								? `Synced from ${sourceDescription}: ${added} new model(s), ${updated} updated.`
								: `Synced from ${sourceDescription}: already up to date.`,
						);
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

	// Discard in-progress edits to the selected provider by restoring the
	// snapshot taken on Edit. We swap the array entry wholesale rather than
	// Object.assign-ing the clone over the live object: Object.assign cannot
	// remove keys the edit ADDED but the snapshot lacks (e.g. an apiKeyRef set on
	// a default provider that had none), so those edits would survive Cancel.
	private restoreSelectedProviderFromClone(): void {
		if (!this.selectedProvider || !this._selectedProviderClone) return;

		const index = this.providers.indexOf(this.selectedProvider);
		if (index !== -1) {
			this.providers[index] = this._selectedProviderClone;
		}

		this.selectedProvider = null;
		this._selectedProviderClone = null;
	}

	addProviderSettingButtonRow(container: HTMLElement) {
		const buttonRow = container.createDiv({
			cls: "button-row qa-ai-provider-button-row",
		});

		const CancelButton = new ButtonComponent(buttonRow);
		CancelButton.setButtonText("Cancel");
		CancelButton.setDestructive();
		CancelButton.onClick(() => {
			// Cancel always returns to the provider list, discarding edits. We
			// never close() here so the modal doesn't flash-close-and-reopen via
			// onClose's path.
			this.restoreSelectedProviderFromClone();

			this.reload();
		});

		const SaveButton = new ButtonComponent(buttonRow);
		SaveButton.setButtonText("Save");
		SaveButton.setCta();
		SaveButton.onClick(() => {
			this.selectedProvider = null;
			this.reload();
		});
	}

	describeModelSource(provider: AIProvider | null): string {
		const mode = provider?.modelSource ?? "providerApi";
		switch (mode) {
			case "modelsDev":
				return "the models.dev directory";
			case "auto":
				return "the provider's models endpoint (falls back to models.dev)";
			default:
				return "the provider's models endpoint";
		}
	}

	onClose(): void {
		// If the user dismissed while editing a provider (Escape / X), discard
		// the in-progress edits by restoring the snapshot, then resolve and close.
		// We do NOT reopen the modal here — reopening on close made Escape re-show
		// the dialog and required a second Escape to actually leave.
		this.restoreSelectedProviderFromClone();

		this.resolvePromise(this.providers);
		super.onClose();
	}
}
