import { CompleteFormatter } from "./completeFormatter";
import { OptimizedTemplateProcessor } from "../template-engine/OptimizedTemplateProcessor";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";

/**
 * Lightweight adapter that plugs the high-performance
 * `OptimizedTemplateProcessor` into QuickAdd's existing formatter pipeline.
 *
 * By inheriting from `CompleteFormatter` we automatically gain all of the
 * prompting / macro / JS execution features and only need to override the core
 * `format()` stage so that final VALUE / DATE / TEMPLATE substitutions are
 * handled by the single-pass engine.
 */
export class OptimizedFormatter extends CompleteFormatter {
  private readonly processor = new OptimizedTemplateProcessor();

  constructor(
    protected app: App,
    plugin: QuickAdd,
    protected choiceExecutor?: IChoiceExecutor,
  ) {
    super(app, plugin, choiceExecutor);
  }

  protected async format(input: string): Promise<string> {
    let output: string = input;

    // ── Phase 1: retain existing pre-processors that may mutate `variables` ──
    output = await this.replaceInlineJavascriptInString(output);
    output = await this.replaceMacrosInString(output);
    output = await this.replaceTemplateInString(output); // fetch nested templates
    output = await this.replaceSelectedInString(output);
    output = await this.replaceMathValueInString(output);
    output = await this.replaceDateVariableInString(output);

    // ── Phase 2: fast token rendering ──────────────────────────────────────
    output = this.processor.process(output, this.variables as any);

    return output;
  }
}