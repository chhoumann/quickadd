import { vi } from "vitest";
import type { App, TFile } from "obsidian";

export const createMockApp = (): App =>
	({
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(null),
		},
		metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		fileManager: {
			generateMarkdownLink: vi.fn().mockReturnValue(""),
			processFrontMatter: vi.fn(),
		},
		vault: { adapter: { exists: vi.fn() }, cachedRead: vi.fn() },
	}) as unknown as App;

export const createFile = (path = "Target.md"): TFile =>
	({
		path,
		name: path.split("/").pop() ?? path,
		basename: (path.split("/").pop() ?? path).replace(/\.(md|canvas)$/i, ""),
		extension: "md",
	}) as unknown as TFile;

export const createTFile = (path: string): TFile => {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.(md|canvas)$/i, ""),
    extension: path.endsWith(".md") ? "md" : "canvas",
  } as unknown as TFile;
};

export const createMockAppVariant2 = (): App => ({
  workspace: {
    getActiveFile: vi.fn().mockReturnValue(null),
    getActiveViewOfType: vi.fn().mockReturnValue(null),
  },
  metadataCache: {
    getFileCache: vi.fn().mockReturnValue(null),
  },
  fileManager: {
    generateMarkdownLink: vi.fn().mockReturnValue(''),
    processFrontMatter: vi.fn(),
  },
  vault: {
    adapter: { exists: vi.fn() },
    cachedRead: vi.fn(),
  },
} as unknown as App);

