import { QuickAddError } from "./quickAddError";

export class WorkspaceValidationError extends QuickAddError {
  constructor(detailMessage: string) {
    const userMessage = "QuickAdd encountered a problem with the Obsidian workspace configuration.";
    const recoveryHint = "Please reload Obsidian or ensure your vault is open and try again.";

    super(
      `Workspace validation failed: ${detailMessage}`,
      userMessage,
      "WORKSPACE_VALIDATION_ERROR",
      recoveryHint,
      { detail: detailMessage }
    );
  }
}