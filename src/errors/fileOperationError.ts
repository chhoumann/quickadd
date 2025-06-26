import { QuickAddError } from "./quickAddError";

export class FileOperationError extends QuickAddError {
  constructor(
    public operation: "create" | "read" | "update" | "delete",
    public path: string,
    public reason: string
  ) {
    const userMessage = `Unable to ${operation} file \"${path}\"`;
    const recoveryHint = FileOperationError.getRecoveryHint(reason);

    super(
      `File ${operation} failed: ${reason}`,
      userMessage,
      `FILE_${operation.toUpperCase()}_ERROR`,
      recoveryHint,
      { path, operation, reason }
    );
  }

  private static getRecoveryHint(reason: string): string {
    const hints: Record<string, string> = {
      ENOENT: "Check that the folder exists and you have permission to access it.",
      EACCES: "You may not have permission to access this location.",
      EISDIR: "The path points to a directory, not a file.",
      EEXIST: "A file with this name already exists. Try a different name.",
    };
    return hints[reason] || "Please check the file path and try again.";
  }
}