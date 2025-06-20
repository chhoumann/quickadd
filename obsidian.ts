// Stub module for Obsidian API used during tests/build outside of Obsidian.
// It only includes minimal class/shape definitions required by the codebase.
// NOTE: This file is **not** included in the actual plugin build for Obsidian;
// it simply makes `import "obsidian"` work in unit-test environments like Bun/Vitest.

export class TFile {}
export class TFolder {}
export class MarkdownView {
  editor: any = {
    getCursor: () => ({ line: 0, ch: 0 }),
    replaceSelection: () => {},
    setCursor: () => {},
  };
  file?: TFile;
}
export class FileView {}
export class WorkspaceLeaf {
  view: any;
}
export class App {
  workspace: any = {
    getActiveViewOfType: () => undefined,
    getLeaf: () => ({}),
    setActiveLeaf: () => {},
    iterateRootLeaves: () => {},
  };
  vault: any = {
    getAllLoadedFiles: () => [],
    getMarkdownFiles: () => [],
  };
  metadataCache: any = {
    getFileCache: () => undefined,
  };
  commands: any = {
    commands: {},
    editorCommands: {},
    findCommand: () => undefined,
  };
  fileManager: any = {
    generateMarkdownLink: () => "",
  };
}

// Provide default export pattern some code may rely on.
export default {
  TFile,
  TFolder,
  MarkdownView,
  FileView,
  WorkspaceLeaf,
  App,
}; 