import { vi } from "vitest";

// Provide a virtual module that overrides *runtime* resolution but
// leaves TypeScript's type-only resolution intact.
vi.mock("obsidian", () => {
  class Dummy {}
  const moment = (..._args: any[]) => ({
    add: () => ({ format: () => "2025-06-21" }),
    format: () => "2025-06-21",
  });
  (globalThis as any).window ??= globalThis;
  (window as any).moment = moment;

  return {
    App: class {
      workspace: any = {
        getActiveViewOfType: () => undefined,
        getLeaf: () => ({}),
        setActiveLeaf: () => {},
        iterateRootLeaves: () => {},
      };
      vault: any = {
        getAllLoadedFiles: () => [],
        getMarkdownFiles: () => [],
        read: async () => "",
        modify: async () => {},
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
      plugins: any = {
        plugins: {},
      };
    },
    TFile: class { 
      path = ""; 
      name = "";
      extension = "";
      basename = "";
      parent = null;
    },
    TFolder: class {
      path = "";
      name = "";
      children = [];
    },
    MarkdownView: class { 
      editor = { 
        getCursor() {return {line:0,ch:0};}, 
        replaceSelection() {}, 
        setCursor() {} 
      }; 
      file?: any;
    },
    FileView: class {
      file?: any;
    },
    WorkspaceLeaf: class { 
      view: any; 
      getViewState() {return {state:{}};} 
      setViewState(){} 
      openFile(){} 
    },
    FuzzySuggestModal: class {
      constructor(app: any) {}
      open() {}
      close() {}
    },
    Modal: class {
      constructor(app: any) {}
      open() {}
      close() {}
    },
    Scope: class {
      register(hotkeys: any, callback: any) {}
    },
    moment,                      // if someone imports it directly
  };
}, { virtual: true }); 