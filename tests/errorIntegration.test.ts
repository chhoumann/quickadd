import { describe, it, expect, vi } from "vitest";
import { SingleTemplateEngine } from "../src/engine/SingleTemplateEngine";
import { TemplateProcessingError } from "../src/errors/templateProcessingError";
import { WorkspaceValidationError } from "../src/errors/workspaceValidationError";
import invariant from "../src/utils/invariant";
import { App } from "./obsidian-stub";

// Minimal QuickAdd stub
const pluginStub = {
  settings: { macros: [] },
} as unknown as import("../src/main").default;

describe("Integration – error handling", () => {
  it("SingleTemplateEngine wraps template errors", async () => {
    const app = new App();
    // Provide vault adapter that reports file does not exist
    app.vault.adapter = {
      exists: async () => false,
    } as any;
    // Provide vault API stubs
    app.vault.getAbstractFileByPath = () => undefined as any;

    const engine = new SingleTemplateEngine(app as any, pluginStub, "non-existent.md");

    await expect(engine.run()).rejects.toBeInstanceOf(TemplateProcessingError);
  });

  it("invariant throws WorkspaceValidationError", () => {
    expect(() => invariant(false, "workspace is not ready"))
      .toThrow(WorkspaceValidationError);
  });
});