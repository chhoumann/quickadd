// Stub module for Obsidian API used during tests
// This file provides minimal runtime implementations for testing

const moment = (..._args: any[]) => ({
  add: () => ({ format: () => "2025-06-21" }),
  format: () => "2025-06-21",
});

// Ensure window and global moment are available
(globalThis as any).window ??= globalThis;
(globalThis as any).window.moment = moment;

export const App = class {
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
    cachedRead: async () => "",
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
};

export const TFile = class { 
  path = ""; 
  name = "";
  extension = "";
  basename = "";
  parent = null;
};

export const TFolder = class {
  path = "";
  name = "";
  children = [];
};

export const MarkdownView = class { 
  editor = { 
    getCursor() {return {line:0,ch:0};}, 
    replaceSelection() {}, 
    setCursor() {} 
  }; 
  file?: any;
};

export const FileView = class {
  file?: any;
};

export const WorkspaceLeaf = class { 
  view: any; 
  getViewState() {return {state:{}};} 
  setViewState(){} 
  openFile(){} 
};

export const FuzzySuggestModal = class {
  constructor(app: any) {}
  open() {}
  close() {}
};

export const Modal = class {
  constructor(app: any) {}
  open() {}
  close() {}
};

export const Scope = class {
  register(hotkeys: any, callback: any) {}
};

export { moment };

// Default export for compatibility
export default {
  App,
  TFile,
  TFolder,
  MarkdownView,
  FileView,
  WorkspaceLeaf,
  FuzzySuggestModal,
  Modal,
  Scope,
  moment,
};
