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

export class BaseComponent {
  disabled = false;

  then(cb: (component: this) => any): this {
    cb(this);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
}

export class Component extends BaseComponent {
  load() {}
  onload() {}
  unload() {}
  onunload() {}
}

export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    super();
    this.buttonEl = document.createElement("button");
    containerEl.appendChild(this.buttonEl);
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  setCta(): this {
    return this;
  }

  setTooltip(): this {
    return this;
  }

  setIcon(): this {
    return this;
  }

  setClass(): this {
    return this;
  }

  onClick(cb: () => void): this {
    this.buttonEl.addEventListener("click", cb);
    return this;
  }
}

export class ToggleComponent extends BaseComponent {
  toggleEl: HTMLInputElement;

  constructor(containerEl: HTMLElement) {
    super();
    this.toggleEl = document.createElement("input");
    this.toggleEl.type = "checkbox";
    containerEl.appendChild(this.toggleEl);
  }

  setValue(value: boolean): this {
    this.toggleEl.checked = value;
    return this;
  }

  setTooltip(): this {
    return this;
  }

  onChange(cb: (value: boolean) => void): this {
    this.toggleEl.addEventListener("change", () => cb(this.toggleEl.checked));
    return this;
  }
}

export class DropdownComponent extends BaseComponent {
  selectEl: HTMLSelectElement;

  constructor(containerEl: HTMLElement) {
    super();
    this.selectEl = document.createElement("select");
    containerEl.appendChild(this.selectEl);
  }

  addOption(value: string, text: string): this {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    this.selectEl.appendChild(option);
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  onChange(cb: (value: string) => void): this {
    this.selectEl.addEventListener("change", () => cb(this.selectEl.value));
    return this;
  }
}

export class TextComponent extends BaseComponent {
  inputEl: HTMLInputElement;

  constructor(containerEl: HTMLElement) {
    super();
    this.inputEl = document.createElement("input");
    containerEl.appendChild(this.inputEl);
  }

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  setTooltip(): this {
    return this;
  }

  onChange(cb: (value: string) => void): this {
    this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
    return this;
  }
}

export class SecretComponent extends BaseComponent {
  inputEl: HTMLInputElement;

  constructor(_app: App, containerEl: HTMLElement) {
    super();
    this.inputEl = document.createElement("input");
    containerEl.appendChild(this.inputEl);
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(cb: (value: string) => void): this {
    this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
    return this;
  }
}

export class TextAreaComponent extends BaseComponent {
  inputEl: HTMLTextAreaElement;

  constructor(containerEl: HTMLElement) {
    super();
    this.inputEl = document.createElement("textarea");
    containerEl.appendChild(this.inputEl);
  }

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(cb: (value: string) => void): this {
    this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: BaseComponent[] = [];

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.infoEl = document.createElement("div");
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.controlEl = document.createElement("div");
    this.settingEl.appendChild(this.infoEl);
    this.settingEl.appendChild(this.controlEl);
    containerEl.appendChild(this.settingEl);
  }

  setName(name: string | DocumentFragment): this {
    if (typeof name === "string") {
      this.nameEl.textContent = name;
    } else {
      this.nameEl.appendChild(name);
    }
    if (!this.infoEl.contains(this.nameEl)) this.infoEl.appendChild(this.nameEl);
    return this;
  }

  setDesc(desc: string | DocumentFragment): this {
    if (typeof desc === "string") {
      this.descEl.textContent = desc;
    } else {
      this.descEl.appendChild(desc);
    }
    if (!this.infoEl.contains(this.descEl)) this.infoEl.appendChild(this.descEl);
    return this;
  }

  setClass(): this {
    return this;
  }

  setTooltip(): this {
    return this;
  }

  setHeading(): this {
    return this;
  }

  setDisabled(): this {
    return this;
  }

  addButton(cb: (component: ButtonComponent) => any): this {
    cb(new ButtonComponent(this.controlEl));
    return this;
  }

  addToggle(cb: (component: ToggleComponent) => any): this {
    cb(new ToggleComponent(this.controlEl));
    return this;
  }

  addText(cb: (component: TextComponent) => any): this {
    cb(new TextComponent(this.controlEl));
    return this;
  }

  addTextArea(cb: (component: TextAreaComponent) => any): this {
    cb(new TextAreaComponent(this.controlEl));
    return this;
  }

  addDropdown(cb: (component: DropdownComponent) => any): this {
    cb(new DropdownComponent(this.controlEl));
    return this;
  }

  addComponent<T extends BaseComponent>(cb: (el: HTMLElement) => T): this {
    const el = document.createElement("div");
    this.controlEl.appendChild(el);
    const component = cb(el);
    this.components.push(component);
    return this;
  }
}

export class SettingGroup {
  groupEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.groupEl = document.createElement("div");
    containerEl.appendChild(this.groupEl);
  }

  setHeading(text: string | DocumentFragment): this {
    const headingEl = document.createElement("h3");
    if (typeof text === "string") {
      headingEl.textContent = text;
    } else {
      headingEl.appendChild(text);
    }
    this.groupEl.appendChild(headingEl);
    return this;
  }

  addClass(cls: string): this {
    this.groupEl.classList.add(cls);
    return this;
  }

  addSetting(cb: (setting: Setting) => void): this {
    cb(new Setting(this.groupEl));
    return this;
  }
}

// Ensure window and global moment are available
(globalThis as any).window ??= globalThis;
(globalThis as any).window.moment = moment;

export class App {
  private secretStore = new Map<string, string>();
  secretStorage = {
    getSecret: (name: string) => this.secretStore.get(name) ?? null,
    setSecret: (name: string, value: string) => {
      this.secretStore.set(name, value);
    },
    listSecrets: () => Array.from(this.secretStore.keys()),
    delete: async (name: string) => {
      this.secretStore.delete(name);
    },
  };
  workspace: any = {
    getActiveViewOfType: () => undefined,
    getLeaf: () => ({}),
    setActiveLeaf: () => {},
    iterateRootLeaves: () => {},
  };
  vault: any = {
    configDir: ".obsidian",
    getRoot: () => ({ path: "" }),
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
}

export class Plugin {
  app: App;
  manifest: { dir: string };

  constructor() {
    this.app = new App();
    this.manifest = { dir: "" };
  }

  addRibbonIcon() { return { addClass() {}, setAttr() {} }; }
  addCommand() { return { id: "", name: "" }; }
  addSettingTab() {}
  registerEvent() {}
  registerInterval() {}
  registerDomEvent() {}
  onunload() {}
  async onload() {}
}

export class PluginSettingTab {
  app: App;
  containerEl: HTMLElement;
  icon?: string;

  constructor(app: App, _plugin?: Plugin) {
    this.app = app;
    this.containerEl = document.createElement("div");
  }

  display() {}
  hide() {}
}

export class TFile { 
  path = ""; 
  name = "";
  extension = "";
  basename = "";
  parent = null;
}

export class TFolder {
  path = "";
  name = "";
  children = [];
}

export class MarkdownView { 
  editor = { 
    getCursor() {return {line:0,ch:0};}, 
    replaceSelection() {}, 
    setCursor() {} 
  }; 
  file?: any;
}

export class FileView {
  file?: any;
}

export class WorkspaceLeaf { 
  view: any; 
  getViewState() {return {state:{}};} 
  setViewState(){} 
  openFile(){} 
}

export class FuzzySuggestModal<T = unknown> {
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
  callbacks = new Map<string, (event: any) => unknown>();

  register(_hotkeys: any, key: any, callback?: any) {
    if (typeof key === "string" && typeof callback === "function") {
      this.callbacks.set(key, callback);
    } else if (typeof key === "function") {
      this.callbacks.set("", key);
    }
  }

  trigger(key: string, event: any = { isComposing: false }): unknown {
    return this.callbacks.get(key)?.(event);
  }
};

export const MarkdownRenderer = {
  async render(
    _app: unknown,
    source: string,
    el: HTMLElement,
    sourcePath: string,
    component: unknown,
  ): Promise<void> {
    await MarkdownRenderer.renderMarkdown(source, el, sourcePath, component);
  },

  async renderMarkdown(
    source: string,
    el: HTMLElement,
    _sourcePath: string,
    _component: unknown,
  ): Promise<void> {
    el.replaceChildren();
    const strongPattern = /\*\*([^*]+)\*\*/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = strongPattern.exec(source)) !== null) {
      if (match.index > cursor) {
        el.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      }

      const strong = document.createElement("strong");
      strong.textContent = match[1];
      el.appendChild(strong);
      cursor = match.index + match[0].length;
    }

    if (cursor < source.length) {
      el.appendChild(document.createTextNode(source.slice(cursor)));
    }
  },
};

export async function requestUrl(request: string | { url: string; throw?: boolean }): Promise<{
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
}> {
  const url = typeof request === "string" ? request : request.url;
  const response = await fetch(url);
  const text = await response.text();
  let json: unknown = text;

  try {
    json = JSON.parse(text);
  } catch {
    // Preserve text response when it is not JSON.
  }

  return {
    status: response.status,
    headers: {},
    arrayBuffer: await new Blob([text]).arrayBuffer(),
    json,
    text,
  };
}

export class Notice {
  static instances: Array<{ message: string; timeout?: number; messageEl: HTMLElement }> = [];
  noticeEl: HTMLElement;
  containerEl: HTMLElement;
  messageEl: HTMLElement;
  message: string;
  timeout?: number;

  constructor(message: string, timeout?: number) {
    this.containerEl = document.createElement("div");
    this.messageEl = document.createElement("div");
    this.noticeEl = this.messageEl;
    this.containerEl.appendChild(this.messageEl);
    this.messageEl.textContent = message;
    this.message = message;
    this.timeout = timeout;
    Notice.instances.push({ message, timeout, messageEl: this.messageEl });
  }

  hide() {}
}

export { moment };

// Minimal normalizePath for tests: convert Windows separators to POSIX
export function normalizePath(p: string): string {
  if (typeof p !== 'string') return '' as unknown as string;
  return p.replace(/\\/g, '/');
}

// Minimal debounce for tests: execute immediately.
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  _wait: number,
  _resetTimer?: boolean,
): T {
  return fn;
}

// Standalone setIcon (used by ObsidianIcon.svelte and choiceBuilder.ts).
// Replaces the element's existing icon with a single <svg data-icon="..."> so
// component tests can assert which icon is rendered and that it swaps reactively.
export function setIcon(parent: HTMLElement, iconId: string): void {
  const existing = parent.querySelector("svg");
  if (existing) existing.remove();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-icon", iconId);
  parent.appendChild(svg);
}

// Minimal Menu stub for context-menu tests. Records its items and how it was
// shown (mouse event vs. anchored position) so tests can assert the keyboard path.
export class MenuItem {
  title = "";
  icon = "";
  disabled = false;
  clickHandler: (() => void) | null = null;
  setTitle(title: string): this {
    this.title = title;
    return this;
  }
  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
  onClick(handler: () => void): this {
    this.clickHandler = handler;
    return this;
  }
}

export class Menu {
  static lastShown: Menu | null = null;
  items: MenuItem[] = [];
  shownAt: { type: "mouse" | "position"; detail: unknown } | null = null;
  addItem(cb: (item: MenuItem) => void): this {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this {
    return this;
  }
  showAtMouseEvent(evt: MouseEvent): this {
    this.shownAt = { type: "mouse", detail: evt };
    Menu.lastShown = this;
    return this;
  }
  showAtPosition(pos: { x: number; y: number }): this {
    this.shownAt = { type: "position", detail: pos };
    Menu.lastShown = this;
    return this;
  }
}

// Substring (NOT subsequence) matcher standing in for Obsidian's fuzzy search.
// Returns a SearchResult-like object when q is a case-insensitive substring of
// the text, else null — enough for filter tests. Do NOT assert true fuzzy
// (subsequence) semantics against this stub.
export function prepareFuzzySearch(query: string) {
  const q = query.toLowerCase();
  return (text: string) => {
    if (q.length === 0) return { score: 0, matches: [] as Array<[number, number]> };
    return text.toLowerCase().includes(q)
      ? { score: 0, matches: [] as Array<[number, number]> }
      : null;
  };
}

// Default export for compatibility
export default {
  App,
  Component,
  BaseComponent,
  ButtonComponent,
  ToggleComponent,
  DropdownComponent,
  TextComponent,
  TextAreaComponent,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingGroup,
  TFile,
  TFolder,
  MarkdownView,
  FileView,
  WorkspaceLeaf,
  FuzzySuggestModal,
  Modal,
  Menu,
  MenuItem,
  Scope,
  MarkdownRenderer,
  requestUrl,
  Notice,
  moment,
  normalizePath,
  debounce,
  setIcon,
  prepareFuzzySearch,
};
