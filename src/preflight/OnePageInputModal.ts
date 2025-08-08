import { App, Modal, Setting, TextAreaComponent, TextComponent, DropdownComponent } from "obsidian";
import type { FieldRequirement } from "./RequirementCollector";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";

export class OnePageInputModal extends Modal {
  private readonly requirements: FieldRequirement[];
  private readonly initialValues: Map<string, string>;
  private readonly result = new Map<string, string>();

  public waitForClose: Promise<Record<string, string>>;
  private resolvePromise!: (values: Record<string, string>) => void;
  private rejectPromise!: (reason?: unknown) => void;

  constructor(app: App, requirements: FieldRequirement[], initial?: Map<string, unknown>) {
    super(app);
    this.requirements = requirements;
    this.initialValues = new Map<string, string>();
    initial?.forEach((v, k) => {
      if (typeof v === "string") this.initialValues.set(k, v);
    });

    this.waitForClose = new Promise<Record<string, string>>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });

    this.display();
    this.open();
  }

  private display() {
    this.containerEl.addClass("quickAddModal", "onePageInputModal");
    this.contentEl.empty();

    const title = this.contentEl.createEl("h2", { text: "Provide inputs" });
    title.style.textAlign = "center";

    // Render fields
    this.requirements.forEach((req) => this.renderField(req));

    // Action bar
    const btnRow = this.contentEl.createDiv();
    new Setting(btnRow)
      .addButton((btn) => btn.setButtonText("Submit").setCta().onClick(() => this.submit()))
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.cancel()));
  }

  private renderField(req: FieldRequirement) {
    const setValue = (id: string, value: string) => this.result.set(id, value);
    const starting = this.initialValues.get(req.id) ?? req.defaultValue ?? "";

    switch (req.type) {
      case "textarea": {
        const setting = new Setting(this.contentEl).setName(req.label);
        if (req.description) setting.setDesc(req.description);
        const input = new TextAreaComponent(setting.controlEl);
        input.setPlaceholder(req.placeholder ?? "").setValue(starting).onChange((v) => setValue(req.id, v));
        input.inputEl.style.width = "100%";
        input.inputEl.style.height = "120px";
        break;
      }
      case "text": {
        const setting = new Setting(this.contentEl).setName(req.label);
        if (req.description) setting.setDesc(req.description);
        const input = new TextComponent(setting.controlEl);
        input.setPlaceholder(req.placeholder ?? "").setValue(starting).onChange((v) => setValue(req.id, v));
        break;
      }
      case "dropdown": {
        const setting = new Setting(this.contentEl).setName(req.label);
        if (req.description) setting.setDesc(req.description);
        const dropdown = new DropdownComponent(setting.controlEl);
        (req.options ?? []).forEach((opt) => dropdown.addOption(opt, opt));
        dropdown.setValue(starting || (req.options?.[0] ?? ""));
        dropdown.onChange((v) => setValue(req.id, v));
        break;
      }
      case "date": {
        const setting = new Setting(this.contentEl).setName(req.label);
        if (req.description) setting.setDesc(req.description);
        // Reuse the VDateInputPrompt component behavior by creating an input with preview
        const input = new TextComponent(setting.controlEl);
        const placeholder = "Enter a date (e.g., 'tomorrow', 'next friday', '2025-12-25')";
        input.setPlaceholder(placeholder).setValue(starting).onChange((v) => setValue(req.id, v));
        // Preview: handled by runtime formatters; this control just captures input
        break;
      }
      case "field-suggest": {
        const setting = new Setting(this.contentEl).setName(req.label);
        if (req.description) setting.setDesc(req.description);
        const input = new TextComponent(setting.controlEl);
        input.setPlaceholder(req.placeholder ?? "").setValue(starting).onChange((v) => setValue(req.id, v));
        // Attach suggester for better UX
        // InputSuggester requires lists; here we fallback to simple text if none.
        // For now, do not open a modal suggester automatically; leave as plain input.
        break;
      }
      case "file-picker": {
        const setting = new Setting(this.contentEl).setName(req.label);
        if (req.description) setting.setDesc(req.description);
        const input = new TextComponent(setting.controlEl);
        input.setPlaceholder(req.placeholder ?? "").setValue(starting).onChange((v) => setValue(req.id, v));
        break;
      }
      default: {
        const setting = new Setting(this.contentEl).setName(req.label);
        const input = new TextComponent(setting.controlEl);
        input.setPlaceholder(req.placeholder ?? "").setValue(starting).onChange((v) => setValue(req.id, v));
      }
    }

    // Initialize stored value for empty inputs to ensure presence
    if (!this.result.has(req.id)) this.result.set(req.id, starting);
  }

  private submit() {
    const out: Record<string, string> = {};
    this.result.forEach((v, k) => (out[k] = v));
    this.close();
    this.resolvePromise(out);
  }

  private cancel() {
    this.close();
    this.rejectPromise("cancelled");
  }
}
