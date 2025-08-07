import { Modal, Setting, Notice } from "obsidian";
import type { AIProvider, Model } from "src/ai/Provider";
import {
  fetchModelsDevDirectory,
  getModelsForProvider,
  mapModelsDevToQuickAdd,
  type ModelsDevModel,
} from "src/ai/modelsDirectory";

export class ModelDirectoryModal extends Modal {
  public waitForClose: Promise<{ imported: Model[]; mode: "add" | "replace" } | null>;

  private resolvePromise: (result: { imported: Model[]; mode: "add" | "replace" } | null) => void;
  private rejectPromise: (reason?: unknown) => void;

  private provider: AIProvider;
  private allModels: ModelsDevModel[] = [];
  private filtered: ModelsDevModel[] = [];
  private selectedIds = new Set<string>();
  private mode: "add" | "replace" = "add";

  constructor(app: import("obsidian").App, provider: AIProvider) {
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
      await fetchModelsDevDirectory();
      this.allModels = await getModelsForProvider(this.provider);
      this.filtered = this.allModels.slice();
    } catch (err) {
      new Notice(`Failed to load model directory: ${(err as { message?: string }).message ?? err}`);
    }
  }

  private display() {
    this.contentEl.empty();

    this.contentEl.createEl("h2", { text: `Browse models for ${this.provider.name}` }).style.textAlign = "center";

    // Search/filter
    new Setting(this.contentEl)
      .setName("Search")
      .addText((text) => {
        text.setPlaceholder("Filter by name or id").onChange((value) => {
          const q = value.trim().toLowerCase();
          this.filtered = this.allModels.filter((m) => m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q));
          this.renderList();
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("check");
        btn.setTooltip("Select all");
        btn.onClick(() => {
          this.filtered.forEach((m) => this.selectedIds.add(m.id));
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
    const list = this.contentEl.createDiv({ cls: "qa-model-directory" });
    list.style.maxHeight = "400px";
    list.style.overflowY = "auto";
    list.style.padding = "6px";

    this.renderList();
  }

  private renderList() {
    const list = this.contentEl.querySelector(".qa-model-directory");
    if (!list) return;
    list.empty();

    for (const m of this.filtered) {
      const row = list.createDiv({ cls: "qa-model-row" });
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.selectedIds.has(m.id);
      cb.onchange = () => {
        if (cb.checked) this.selectedIds.add(m.id);
        else this.selectedIds.delete(m.id);
      };
      row.appendChild(cb);

      const title = row.createDiv({ text: m.name ?? m.id });
      title.style.flex = "1";

      const meta = row.createDiv({ text: `${m.limit?.context ?? "?"} tokens ctx` });
      meta.style.opacity = "0.7";
      meta.style.fontSize = "0.9em";
    }
  }

  private importSelected() {
    if (this.selectedIds.size === 0) {
      new Notice("Select at least one model.");
      return;
    }
    const selection = this.allModels.filter((m) => this.selectedIds.has(m.id));
    const qaModels = mapModelsDevToQuickAdd(selection);
    this.resolvePromise({ imported: qaModels, mode: this.mode });
    this.close();
  }

  onClose(): void {
    if (!this.selectedIds || this.selectedIds.size === 0) {
      this.resolvePromise(null);
    }
    super.onClose();
  }
}
