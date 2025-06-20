import { vi } from "vitest";

vi.mock("obsidian", () => {
  class Dummy {}
  return {
    MarkdownView: Dummy,
    TFile: Dummy,
    App: Dummy,
    FileView: Dummy,
    WorkspaceLeaf: Dummy,
    FuzzySuggestModal: Dummy,
    Modal: Dummy,
    Scope: Dummy,
  };
}); 