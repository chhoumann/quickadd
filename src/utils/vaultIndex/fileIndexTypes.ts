import type { TFile } from "obsidian";

export interface IndexedFile {
	path: string;
	pathNormalized: string;
	basename: string;
	basenameNormalized: string;
	aliases: string[];
	aliasesNormalized: string[];
	headings: string[];
	blockIds: string[];
	tags: string[];
	modified: number;
	openedAt?: number;
	folder: string;
}

export interface SearchContext {
	currentFile?: TFile;
	currentFolder?: string;
	recentFiles?: TFile[];
}
