import type { App } from "obsidian";
import { Formatter } from "src/formatters/formatter";
import type QuickAdd from "src/main";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import { NLDParser } from "src/parsers/NLDParser";
import { TEMPLATE_REGEX } from "src/constants";

export type FieldType =
  | "text"
  | "textarea"
  | "dropdown"
  | "date"
  | "field-suggest"
  | "file-picker";

export interface FieldRequirement {
  id: string;           // variable key or special input id
  label: string;        // user-facing label
  type: FieldType;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: string[];   // for dropdowns
  // Additional metadata
  dateFormat?: string;  // for VDATE
  filters?: string;     // serialized filters for FIELD variables
}

/**
 * RequirementCollector walks through strings that may contain QuickAdd format
 * syntax and records inputs we'd otherwise prompt for at runtime. It never
 * executes macros, scripts, or inline JavaScript. It returns inert replacements
 * so that formatting can continue to discover further requirements.
 */
export class RequirementCollector extends Formatter {
  public readonly requirements = new Map<string, FieldRequirement>();

  constructor(
    protected app: App,
    private plugin: QuickAdd,
    protected choiceExecutor?: IChoiceExecutor
  ) {
    super();
    this.dateParser = NLDParser;
    if (choiceExecutor) {
      this.variables = choiceExecutor.variables;
    }
  }

  // Entry points -------------------------------------------------------------
  public async scanString(input: string): Promise<void> {
    // Run a safe formatting pass that collects variables but avoids side-effects
    await this.format(input);
  }

  protected async format(input: string): Promise<string> {
    let output = input;

    // NOTE: Intentionally skip macros, inline js, templates content resolution
    // We will only record the TEMPLATE references for later recursive scanning.

    // Dates/Times
    output = this.replaceDateInString(output);
    output = this.replaceTimeInString(output);

    // VALUE & NAME
    output = await this.replaceValueInString(output);

    // Clipboard/Selected: keep inert
    output = await this.replaceSelectedInString(output);
    output = await this.replaceClipboardInString(output);

    // VDATE + VALUE variables + FIELD
    output = await this.replaceDateVariableInString(output);
    output = await this.replaceVariableInString(output);
    output = await this.replaceFieldVarInString(output);

    // Math value
    output = await this.replaceMathValueInString(output);

    // Random
    output = this.replaceRandomInString(output);

    // Record any template inclusions for callers to handle separately
    while (TEMPLATE_REGEX.test(output)) {
      const exec = TEMPLATE_REGEX.exec(output);
      if (!exec || !exec[1]) break;
      // We do not inline; the caller should scan the referenced template file
      // to find additional requirements.
      break; // avoid infinite loop
    }

    return output;
  }

  // Formatter hooks ----------------------------------------------------------
  protected async promptForValue(header?: string): Promise<string> {
    const key = "value";
    if (!this.requirements.has(key)) {
      this.requirements.set(key, {
        id: key,
        label: header || "Enter value",
        type: this.plugin.settings.inputPrompt === "multi-line" ? "textarea" : "text",
      });
    }
    return ""; // return inert value to keep scanning
  }

  protected async promptForVariable(
    variableName?: string,
    context?: { type?: string; dateFormat?: string; defaultValue?: string }
  ): Promise<string> {
    if (!variableName) return "";

    // VDATE variables
    if (context?.type === "VDATE" && context.dateFormat) {
      if (!this.requirements.has(variableName)) {
        this.requirements.set(variableName, {
          id: variableName,
          label: variableName,
          type: "date",
          defaultValue: context.defaultValue,
          dateFormat: context.dateFormat,
        });
      }
      return context.defaultValue ?? "";
    }

    // Generic named variables
    if (!this.requirements.has(variableName)) {
      // Detect simple comma-separated option lists
      const hasOptions = variableName.includes(",");
      const req: FieldRequirement = {
        id: variableName,
        label: variableName,
        type: hasOptions ? "dropdown" : "text",
      };
      if (hasOptions) {
        req.options = variableName.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (context?.defaultValue) req.defaultValue = context.defaultValue;
      this.requirements.set(variableName, req);
    }

    return context?.defaultValue ?? "";
  }

  protected async promptForMathValue(): Promise<string> {
    const key = "mvalue";
    if (!this.requirements.has(key)) {
      this.requirements.set(key, {
        id: key,
        label: "Math expression",
        type: "text",
        placeholder: "e.g., 2+2*3",
      });
    }
    return "";
  }

  protected async suggestForField(variableName: string): Promise<string> {
    // Store as a field-suggest requirement; actual suggestions are provided by UI
    if (!this.requirements.has(variableName)) {
      this.requirements.set(variableName, {
        id: variableName,
        label: variableName,
        type: "field-suggest",
      });
    }
    return "";
  }

  protected async suggestForValue(suggestedValues: string[]): Promise<string> {
    // Record a dropdown requirement for these suggestions under a synthetic id
    const key = `suggest:${suggestedValues.join('|')}`;
    if (!this.requirements.has(key)) {
      this.requirements.set(key, {
        id: key,
        label: "Select value",
        type: "dropdown",
        options: suggestedValues,
      });
    }
    return "";
  }

  protected getVariableValue(variableName: string): string {
    // During collection, always resolve to empty string to continue scanning
    return "";
  }

  protected async getTemplateContent(_templatePath: string): Promise<string> {
    // Never read files here; caller scans template files separately
    return "";
  }

  protected async getSelectedText(): Promise<string> { return ""; }
  protected async getClipboardContent(): Promise<string> { return ""; }
  protected getCurrentFileLink(): string | null { return null; }
  protected async getMacroValue(_macroName: string): Promise<string> { return ""; }
}
