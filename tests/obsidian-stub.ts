// Stub module for Obsidian API used during tests
// This file provides minimal runtime implementations for testing

const moment = (...args: any[]) => {
  // Handle date inputs for NLDParser compatibility
  const isValidInput = args.length === 0 || args[0] instanceof Date || typeof args[0] === 'string';
  
  return {
    add: () => ({ format: () => "2025-06-21" }),
    format: (fmt?: string) => {
      if (fmt === "YYYY-MM-DD") return "2025-06-21";
      return "2025-06-21T00:00:00.000Z";
    },
    isValid: () => isValidInput,
    toISOString: () => "2025-06-21T00:00:00.000Z",
  };
};

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

export const FuzzySuggestModal = class<T = unknown> {
  app: any;
  inputEl: HTMLInputElement;
  limit?: number;
  emptyStateText?: string;
  chooser: {
    values: Array<{ item: T; match: { score: number; matches: Array<[number, number]>; } }>;
    selectedItem: number;
  };

  constructor(app: any) {
    this.app = app;
    this.inputEl = document.createElement("input");
    this.chooser = { values: [], selectedItem: 0 };
  }

  open() {}
  close() {}

  setPlaceholder(placeholder: string) {
    this.inputEl.placeholder = placeholder;
  }

  getSuggestions(query: string) {
    const items: T[] = (this as any).getItems?.() ?? [];
    const normalizedQuery = query.toLowerCase();

    const suggestions = items
      .map((item) => {
        const text: string =
          (this as any).getItemText?.(item) ?? String(item ?? "");
        const lowerText = text.toLowerCase();

        let score = -Infinity;
        if (!normalizedQuery) {
          score = 0;
        } else if (lowerText === normalizedQuery) {
          score = 3;
        } else if (lowerText.startsWith(normalizedQuery)) {
          score = 2;
        } else if (lowerText.includes(normalizedQuery)) {
          score = 1;
        }

        return {
          item,
          match: {
            score,
            matches: [] as Array<[number, number]>,
          },
        };
      })
      .filter((suggestion) =>
        normalizedQuery ? suggestion.match.score > -Infinity : true
      )
      .sort((a, b) => b.match.score - a.match.score);

    this.chooser.values = suggestions as any;
    this.chooser.selectedItem = 0;

    return suggestions as any;
  }

  renderSuggestion(value: any, el: HTMLElement): void {
    el.textContent =
      (this as any).getItemText?.(value.item) ?? String(value.item ?? "");
  }

  onChooseSuggestion(value: any, evt: any): void {
    (this as any).onChooseItem?.(value.item, evt);
  }

  selectSuggestion(value: any, evt: any): void {
    this.onChooseSuggestion(value, evt);
  }
};

export const Modal = class {
  constructor(app: any) {}
  open() {}
  close() {}
};

export const Scope = class {
  register(hotkeys: any, callback: any) {}
};

export class Notice {
  static instances: Array<{ message: string; timeout?: number }> = [];
  message: string;
  timeout?: number;

  constructor(message: string, timeout?: number) {
    this.message = message;
    this.timeout = timeout;
    Notice.instances.push({ message, timeout });
  }

  hide() {}
}

export { moment };

// Minimal normalizePath for tests: convert Windows separators to POSIX
export function normalizePath(p: string): string {
  if (typeof p !== 'string') return '' as unknown as string;
  return p.replace(/\\/g, '/');
}

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
  Notice,
  moment,
  normalizePath,
};
