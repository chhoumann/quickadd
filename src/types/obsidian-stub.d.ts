declare module "obsidian" {
  export interface TAbstractFile {
    path: string;
    parent?: { path: string };
  }

  export interface TFile extends TAbstractFile {
    basename: string;
    extension: string;
    stat: { mtime: number };
  }

  export interface HeadingCache { heading: string }
  export interface BlockCache { id?: string }
  export interface TagCache { tag: string }

  export interface FileCache {
    frontmatter?: Record<string, unknown>;
    headings?: HeadingCache[];
    blocks?: Record<string, BlockCache>;
    tags?: TagCache[];
  }

  export interface MetadataCache {
    getFileCache(file: TFile): FileCache | null;
    unresolvedLinks: Record<string, Record<string, unknown>>;
    on(event: string, callback: (...args: unknown[]) => void): () => void;
  }

  export interface Vault {
    getMarkdownFiles(): TFile[];
    getFiles(): TFile[];
    getAbstractFileByPath(path: string): TFile | null;
    on(event: string, callback: (...args: unknown[]) => void): () => void;
  }

  export interface Workspace {
    on(event: string, callback: (...args: unknown[]) => void): () => void;
    getActiveFile(): TFile | null;
  }

  export interface App {
    vault: Vault;
    metadataCache: MetadataCache;
    workspace: Workspace;
    fileManager: {
      generateMarkdownLink(file: TFile, title: string, sourcePath: string, alias?: string): string;
    };
  }

  export interface Plugin {
    registerEvent(dispose: () => void): void;
  }

  const enum Platform {
    Desktop = "desktop",
    Mobile = "mobile",
  }
}