import { QuickAddError } from "./quickAddError";

export class TemplateProcessingError extends QuickAddError {
  constructor(templatePath: string, reason: string) {
    const userMessage = `Failed to process template \"${templatePath}\".`;
    const recoveryHint = TemplateProcessingError.getRecoveryHint(reason);

    super(
      `Template processing failed: ${reason}`,
      userMessage,
      "TEMPLATE_PROCESSING_ERROR",
      recoveryHint,
      { templatePath, reason }
    );
  }

  private static getRecoveryHint(reason: string): string {
    const mapping: Record<string, string> = {
      MALFORMED_SYNTAX: "The template contains invalid syntax. Please review your placeholders and commands.",
      VARIABLE_RESOLUTION: "One or more variables could not be resolved. Ensure all placeholders have values.",
    };
    return mapping[reason] || "Please review the template content and try again.";
  }
}