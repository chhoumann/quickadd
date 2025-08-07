import { Modal, Setting, Notice } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { PROVIDER_PRESETS } from "src/ai/providerPresets";

export class ProviderPickerModal extends Modal {
  public waitForClose: Promise<AIProvider[] | null>;

  private resolvePromise: (providers: AIProvider[] | null) => void;
  private rejectPromise: (reason?: unknown) => void;

  private providers: AIProvider[];

  constructor(app: import("obsidian").App, providers: AIProvider[]) {
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
    container.createEl("h2", { text: "Add a provider" }).style.textAlign = "center";
  }

  private display() {
    this.contentEl.empty();
    // Responsive modal sizing for desktop and mobile
    this.modalEl.style.width = `min(100vw - 32px, 980px)`;
    this.modalEl.style.maxWidth = `980px`;
    this.contentEl.style.maxHeight = `min(85vh, 800px)`;
    this.contentEl.style.overflowY = "auto";
    this.addHeader(this.contentEl);

    const grid = this.contentEl.createDiv();
    grid.style.display = "grid";
    const isMobile = window.innerWidth < 640;
    grid.style.gridTemplateColumns = isMobile
      ? "1fr"
      : "repeat(auto-fill, minmax(260px, 1fr))";
    grid.style.gap = "12px";

    for (const preset of PROVIDER_PRESETS) {
      const card = grid.createDiv({ cls: "qa-provider-card" });
      card.style.border = "1px solid var(--background-modifier-border)";
      card.style.borderRadius = "8px";
      card.style.padding = window.innerWidth < 640 ? "10px" : "12px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "8px";

      const title = card.createEl("div", { text: preset.name });
      title.style.fontWeight = "600";

      const endpoint = card.createEl("div", { text: preset.endpoint });
      endpoint.style.fontSize = "0.9em";
      endpoint.style.opacity = "0.8";

      if (preset.doc) {
        const doc = card.createEl("a", { text: "Docs", href: preset.doc });
        doc.target = "_blank";
        doc.rel = "noopener noreferrer";
      }

      const apiSetting = new Setting(card)
        .setName("API Key")
        .addText((text) => {
          text.setPlaceholder("paste key...");
          text.inputEl.style.width = "100%";
          text.onChange((v) => (text.inputEl.dataset["qa_key"] = v));
        });

      // Make the API key input stack vertically to avoid squishing on narrow screens
      apiSetting.settingEl.style.display = "flex";
      apiSetting.settingEl.style.flexDirection = "column";
      apiSetting.settingEl.style.gap = "6px";

      apiSetting.addButton((b) => {
          b.setButtonText("Connect").setCta().onClick(() => {
            const apiKey = (card.querySelector("input") as HTMLInputElement)?.dataset?.["qa_key"] ?? "";
            const provider: AIProvider = {
              name: preset.name,
              endpoint: preset.endpoint,
              apiKey,
              models: [],
            };
            this.providers.push(provider);
            new Notice(`${preset.name} added. Click Edit to configure models.`);
            this.display();
          });
        });
    }

    new Setting(this.contentEl)
      .setName("Custom provider")
      .setDesc("Create any custom endpoint (OpenAI-compatible or otherwise)")
      .addButton((b) => {
        b.setButtonText("Add custom...").onClick(() => {
          const provider: AIProvider = { name: "Custom", endpoint: "", apiKey: "", models: [] };
          this.providers.push(provider);
          new Notice("Custom provider added. Click Edit to configure.");
          this.display();
        });
      });
  }

  onClose(): void {
    this.resolvePromise(this.providers ?? null);
    super.onClose();
  }
}
