import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { log } from "../logger/logManager";
import { withTemplaterFileCreationSuppressed } from "../utils/templaterIntegration";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";

export function stripLeadingSlash(path: string): string {
	return path.replace(/^\/+/, "");
}

export function normalizeMarkdownFilePath(folderPath: string, fileName: string): string {
	const safeFolderPath = stripLeadingSlash(folderPath);
	const actualFolderPath = safeFolderPath ? `${safeFolderPath}/` : "";
	const formattedFileName = stripLeadingSlash(fileName).replace(MARKDOWN_FILE_EXTENSION_REGEX, "");
	return `${actualFolderPath}${formattedFileName}.md`;
}

export async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!(await app.vault.adapter.exists(folder))) {
		await app.vault.createFolder(folder);
	}
}

export function getFileByPath(app: App, filePath: string): TFile {
	const file = app.vault.getAbstractFileByPath(filePath);

	if (!file) {
		log.logError(`${filePath} not found`);
		throw new Error(`${filePath} not found`);
	}

	if (file instanceof TFolder) {
		log.logError(`${filePath} found but it's a folder`);
		throw new Error(`${filePath} found but it's a folder`);
	}

	if (!(file instanceof TFile)) throw new Error(`${filePath} is not a file`);

	return file;
}

export async function createFileWithInput(
	app: App,
	filePath: string,
	fileContent: string,
	opts: { suppressTemplaterOnCreate?: boolean } = {},
): Promise<TFile> {
	// Authoritative vault-containment boundary for every new-file write (Template
	// and Capture both funnel through here). `filePath` is assembled from formatted
	// names that can be seeded by untrusted input — an obsidian:// URI, the CLI, or
	// `{{VALUE}}` resolved from synced note content. A traversal/absolute/drive/UNC
	// path (e.g. "..\\..\\..\\evil.md" or "C:/evil.md") would make `vault.create`
	// AND the folder pre-creation below resolve OUTSIDE the vault root. Reject it
	// here, before any filesystem touch, so the sink can never escape even if an
	// upstream normalizer is bypassed. Mirrors the package-import write guard.
	if (escapesVaultBoundary(filePath)) {
		throw new Error(`Refusing to create a file outside the vault: "${filePath}".`);
	}

	const dirName = filePath.match(/(.*)[/\\]/)?.[1] ?? "";
	const dir = app.vault.getAbstractFileByPath(dirName);
	if (!dir || !(dir instanceof TFolder)) {
		await ensureFolder(app, dirName);
	}

	const createFile = () => app.vault.create(filePath, fileContent);
	const shouldSuppress = opts.suppressTemplaterOnCreate && filePath.toLowerCase().endsWith(".md");

	return shouldSuppress
		? await withTemplaterFileCreationSuppressed(app, filePath, createFile)
		: await createFile();
}
