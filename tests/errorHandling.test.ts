import { describe, it, expect, vi } from "vitest";
import { ErrorDisplay } from "../src/errors/errorDisplay";
import { TemplateProcessingError } from "../src/errors/templateProcessingError";
import { WorkspaceValidationError } from "../src/errors/workspaceValidationError";

// Stub Notice for testing environment
class NoticeStub {
  static calls: string[] = [];
  constructor(public message: string, _timeout?: number) {
    NoticeStub.calls.push(message);
  }
}
// @ts-ignore
(global as any).Notice = NoticeStub;

// Stub console.error to track calls
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

describe("ErrorDisplay", () => {
  it("shows TemplateProcessingError messages to user and logs details", () => {
    NoticeStub.calls = [];
    const err = new TemplateProcessingError("template.md", "MALFORMED_SYNTAX");
    ErrorDisplay.show(err);

    expect(NoticeStub.calls[0]).toContain("Failed");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("QuickAdd Error:"),
      expect.objectContaining({ code: err.code })
    );
  });

  it("shows WorkspaceValidationError", () => {
    NoticeStub.calls = [];
    const err = new WorkspaceValidationError("workspace should be defined");
    ErrorDisplay.show(err);

    expect(NoticeStub.calls.length).toBeGreaterThan(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("QuickAdd Error:"),
      expect.objectContaining({ code: err.code })
    );
  });
});