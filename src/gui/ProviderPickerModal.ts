import type { App} from "obsidian";
import { Modal, Notice, SecretComponent, Setting } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { cloneModelSeeds, uniqueProviderId } from "src/ai/Provider";
import { syncProviderModels } from "src/ai/modelSyncService";
import type { ProviderPreset } from "src/ai/providerPresets";
import { PROVIDER_PRESETS } from "src/ai/providerPresets";

export class ProviderPickerModal extends Modal {
  public waitForClose: Promise<AIProvider[] | null>;

  private resolvePromise: (providers: AIProvider[] | null) => void;
  private rejectPromise: (reason?: unknown) => void;

  private providers: AIProvider[];

  constructor(app: App, providers: AIProvider[]) {
    super(app);
    this.providers = providers;

    this.waitForClose = new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });

    this.open();
    this.display();
  }

  private addHeader(container: HTMLElement) {
    container.createEl("h2", {
      text: "Add a provider",
      cls: "qa-modal-title",
    });
  }

  private display() {
    this.contentEl.empty();
    this.modalEl.addClass("qa-ai-wide-modal");
    this.contentEl.addClass("qa-ai-scroll-content");
    this.addHeader(this.contentEl);

    const grid = this.contentEl.createDiv({ cls: "qa-provider-grid" });

    for (const preset of PROVIDER_PRESETS) {
      const card = grid.createDiv({ cls: "qa-provider-card" });

      card.createEl("div", { text: preset.name, cls: "qa-provider-card-title" });

      card.createEl("div", {
        text: preset.endpoint,
        cls: "qa-provider-card-endpoint",
      });

      if (preset.doc) {
        const doc = card.createEl("a", { text: "Docs", href: preset.doc });
        doc.target = "_blank";
        doc.rel = "noopener noreferrer";
      }

      let apiKeyRef = "";
      const apiSetting = new Setting(card)
        .setName("API Key")
        .setDesc("Select a secret from SecretStorage")
        .addComponent((el) => new SecretComponent(this.app, el)
          .setValue(apiKeyRef)
          .onChange((value) => {
            apiKeyRef = value;
          }));

      apiSetting.settingEl.addClass("qa-provider-api-setting");

      apiSetting.addButton((b) => {
          b.setButtonText("Connect").setCta().onClick(async () => {
            try {
              const selectedSecret = apiKeyRef.trim();

              // Basic validation
              try {
                // Validate endpoint URL format

                new URL(preset.endpoint);
              } catch {
                new Notice(`Invalid endpoint URL for ${preset.name}.`);
                return;
              }

              const lower = preset.endpoint.toLowerCase();
              const likelyRequiresKey = [
                "openai.com",
                "generativelanguage.googleapis.com",
                "anthropic",
                "api.groq.com",
                "together.xyz",
                "openrouter.ai",
                "router.huggingface.co",
                "api.mistral.ai",
                "api.deepseek.com",
              ].some((s) => lower.includes(s));

              if (likelyRequiresKey && !selectedSecret) {
                new Notice(`${preset.name} requires an API key.`);
                return;
              }

              // Normalize before comparing so trivially-equivalent providers
              // (case / surrounding space / a trailing slash on the endpoint)
              // still count as duplicates.
              const normName = (v: string) => v.trim().toLowerCase();
              const normEndpoint = (v: string) =>
                v.trim().toLowerCase().replace(/\/+$/, "");
              const alreadyExists = this.providers.some(
                (p) =>
                  normName(p.name) === normName(preset.name) &&
                  normEndpoint(p.endpoint) === normEndpoint(preset.endpoint),
              );
              if (alreadyExists) {
                new Notice(`${preset.name} is already configured.`);
                return;
              }

              const provider: AIProvider = {
                name: preset.name,
                endpoint: preset.endpoint,
                id: uniqueProviderId(preset.id, this.providers),
                kind: preset.kind,
                apiKey: "",
                apiKeyRef: selectedSecret,
                models: [],
                modelSource: preset.modelSource ?? "auto",
                autoSyncModels: true,
              };

              // Import the provider's current models right away — connecting a
              // provider should end with working models, not a manual sync step.
              b.setButtonText("Connecting...");
              b.setDisabled(true);
              await this.importInitialModels(provider, preset);

              this.providers.push(provider);
              // Close after a successful add so the success is unambiguous and
              // a stray second click can't push a duplicate.
              this.close();
            } catch (err) {
              b.setButtonText("Connect");
              b.setDisabled(false);
              new Notice(`Failed to add provider: ${(err as { message?: string }).message ?? err}`);
            }
          });
        });
    }

    new Setting(this.contentEl)
      .setName("Custom provider")
      .setDesc("Create any custom endpoint (OpenAI-compatible or otherwise)")
      .addButton((b) => {
        b.setButtonText("Add custom...").onClick(() => {
          const provider: AIProvider = { id: uniqueProviderId("custom", this.providers), name: "Custom", endpoint: "", apiKey: "", apiKeyRef: "", models: [], modelSource: "providerApi" };
          this.providers.push(provider);
          new Notice("Custom provider added. Click Edit to configure.");
          this.close();
        });
      });
  }

  /**
   * Live-import models for a just-connected provider. Failures never block the
   * add: presets with a shipped seed list fall back to it (current at ship
   * time; auto-sync refreshes it once the provider is reachable), the rest get
   * a pointer to retry from the provider's settings.
   */
  private async importInitialModels(
    provider: AIProvider,
    preset: ProviderPreset,
  ): Promise<void> {
    try {
      await syncProviderModels(this.app, provider);
      new Notice(
        `${preset.name} connected with ${provider.models.length} models.`,
      );
    } catch (err) {
      const message = (err as { message?: string }).message ?? String(err);
      if (preset.seedKey) {
        provider.models = cloneModelSeeds(preset.seedKey);
        new Notice(
          `${preset.name} added with its built-in model list. Live model loading failed: ${message}`,
        );
      } else {
        new Notice(
          `${preset.name} added, but loading models failed: ${message} Use "Sync now" in the provider's settings to retry.`,
        );
      }
    }
  }

  onClose(): void {
    this.resolvePromise(this.providers ?? null);
    super.onClose();
  }
}
