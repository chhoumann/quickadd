import { App, Modal, Setting, TextAreaComponent, TextComponent, DropdownComponent } from "obsidian";
import type { FieldRequirement } from "./RequirementCollector";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import { FieldValueInputSuggest } from "src/gui/suggesters/FieldValueInputSuggest";
import { parseNaturalLanguageDate, formatISODate } from "src/utils/dateParser";

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
        const container = setting.controlEl.createDiv();
        const input = new TextComponent(container);
        const placeholder = "Enter a date (e.g., 'today', 'next friday', '2025-12-25')";

        // Friendly display: if initial is @date:ISO, show formatted text instead
        let displayValue = starting;
        if (starting?.startsWith("@date:") && req.dateFormat) {
          const iso = starting.slice(6);
          const formatted = formatISODate(iso, req.dateFormat);
          if (formatted) displayValue = formatted;
        }
        input.setPlaceholder(placeholder).setValue(displayValue ?? "");

        const preview = container.createDiv();
        preview.style.marginTop = "0.25rem";
        preview.style.fontSize = "0.9em";
        preview.style.fontFamily = "var(--font-monospace)";
        const updatePreview = (val: string) => {
          const inputVal = (val ?? "").trim();
          if (!inputVal && req.defaultValue) {
            preview.setText(`Default → ${req.defaultValue}`);
            preview.style.color = "var(--text-muted)";
            setValue(req.id, "");
            return;
          }
          if (!inputVal) {
            preview.setText("Preview will appear here");
            preview.style.color = "var(--text-muted)";
            setValue(req.id, "");
            return;
          }

          // Live-parse natural language dates and preview the formatted value
          const parsed = parseNaturalLanguageDate(inputVal, req.dateFormat);
          if (parsed.isValid && parsed.formatted && parsed.isoString) {
            preview.setText(parsed.formatted);
            preview.style.color = "var(--text-normal)";
            // Store normalized value for execution
            setValue(req.id, `@date:${parsed.isoString}`);
          } else {
            preview.setText(parsed.error || "Unable to parse date");
            preview.style.color = "var(--text-error)";
            // Keep value empty to avoid committing invalid dates
            setValue(req.id, "");
          }
        };
        input.onChange((v) => updatePreview(v));
        // Initialize preview
        updatePreview(displayValue ?? "");
        break;
      }
      case "field-suggest": {
        const setting = new Setting(this.contentEl).setName(req.label);
        if (req.description) setting.setDesc(req.description);
        const input = new TextComponent(setting.controlEl);
        input.setPlaceholder(req.placeholder ?? "").setValue(starting).onChange((v) => setValue(req.id, v));
        // Attach inline suggester powered by vault data & filters encoded in req.id
        try {
          new FieldValueInputSuggest(this.app, input.inputEl, req.id);
        } catch {
          // Non-fatal; leave as plain input if suggester fails
        }
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
