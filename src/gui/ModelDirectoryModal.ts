import type { App } from "obsidian";
import { Modal, Notice, Setting } from "obsidian";
import type { AIProvider, Model } from "src/ai/Provider";
import { discoverProviderModels } from "src/ai/modelDiscoveryService";
import { resolveProviderApiKey } from "src/ai/providerSecrets";

export class ModelDirectoryModal extends Modal {
  public waitForClose: Promise<{ imported: Model[]; mode: "add" | "replace" } | null>;

  private resolvePromise: (result: { imported: Model[]; mode: "add" | "replace" } | null) => void;
  private rejectPromise: (reason?: unknown) => void;

  private provider: AIProvider;
  private allModels: Model[] = [];
  private filtered: Model[] = [];
  private selectedIds = new Set<string>();
  private mode: "add" | "replace" = "add";
  private resolved = false;

  constructor(app: App, provider: AIProvider) {
    super(app);
    this.provider = provider;

    this.waitForClose = new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });

    this.open();
    void this.loadData().then(() => this.display());
  }

  private async loadData() {
    try {
      const apiKey = await resolveProviderApiKey(this.app, this.provider);
      this.allModels = await discoverProviderModels(this.provider, apiKey);
      this.filtered = this.allModels.slice();
    } catch (err) {
      new Notice(`Failed to load model directory: ${(err as { message?: string }).message ?? err}`);
    }
  }

  private display() {
    this.contentEl.empty();
    this.modalEl.addClass("qa-ai-wide-modal");
    this.contentEl.addClass("qa-ai-scroll-content");

    this.contentEl.createEl("h2", {
      text: `Browse models for ${this.provider.name}`,
      cls: "qa-modal-title",
    });

    // Search/filter
    new Setting(this.contentEl)
      .setName("Search")
      .addText((text) => {
        text.setPlaceholder("Filter by name or id").onChange((value) => {
          const q = value.trim().toLowerCase();
          this.filtered = this.allModels.filter((m) => m.name.toLowerCase().includes(q));
          this.renderList();
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("check");
        btn.setTooltip("Select all");
        btn.onClick(() => {
          this.filtered.forEach((m) => this.selectedIds.add(m.name));
          this.renderList();
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("x");
        btn.setTooltip("Clear selection");
        btn.onClick(() => {
          this.selectedIds.clear();
          this.renderList();
        });
      });

    // Mode toggle
    new Setting(this.contentEl)
      .setName("Import mode")
      .setDesc("Add will append new models. Replace will overwrite existing models with the selected list.")
      .addDropdown((dd) => {
        dd.addOption("add", "Add only");
        dd.addOption("replace", "Replace existing");
        dd.setValue(this.mode);
        dd.onChange((v) => (this.mode = v as "add" | "replace"));
      })
      .addButton((b) => {
        b.setButtonText("Import selected").setCta().onClick(() => this.importSelected());
      });

    // List container
    this.contentEl.createDiv({ cls: "qa-model-directory" });

    this.renderList();
  }

  private renderList() {
    const list = this.contentEl.querySelector(".qa-model-directory");
    if (!list) return;
    list.empty();

    for (const m of this.filtered) {
      const row = list.createDiv({ cls: "qa-model-row" });

      const cb = this.contentEl.ownerDocument.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.selectedIds.has(m.name);
      cb.onchange = () => {
        if (cb.checked) this.selectedIds.add(m.name);
        else this.selectedIds.delete(m.name);
      };
      row.appendChild(cb);

      row.createDiv({ text: m.name, cls: "qa-model-row-title" });

      row.createDiv({
        text: `${m.maxTokens.toLocaleString()} tokens max`,
        cls: "qa-model-row-meta",
      });
    }
  }

  private importSelected() {
    if (this.selectedIds.size === 0) {
      new Notice("Select at least one model.");
      return;
    }
    try {
      const selection = this.allModels.filter((m) => this.selectedIds.has(m.name));
      const qaModels = selection.map((model) => ({ ...model }));
      if (!qaModels.length) {
        new Notice("No models selected to import.");
        return;
      }
      this.resolved = true;
      this.resolvePromise({ imported: qaModels, mode: this.mode });
      this.close();
    } catch (err) {
      new Notice(`Import failed: ${(err as { message?: string }).message ?? err}`);
    }
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolvePromise(null);
    }
    super.onClose();
  }
}
