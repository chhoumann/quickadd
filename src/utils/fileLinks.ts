import type { App } from "obsidian";
import { Notice, TFile } from "obsidian";
import { log } from "../logger/logManager";
import type {
	AppendLinkDestination,
	AppendLinkOptions,
	LinkPlacement,
	LinkType,
} from "../types/linkPlacement";
import { placementSupportsEmbed } from "../types/linkPlacement";
import { convertLinkToEmbed } from "./markdownLinks";

const CLIPBOARD_NOTICE_DURATION_MS = 4000;

type FileLinkTextOptions = {
	sourcePath?: string;
	linkType?: LinkType;
	placement?: LinkPlacement;
};

export function buildPortableFileLinkText(file: TFile): string {
	const path = file.path.replace(/\.md$/i, "");
	return `[[${path}]]`;
}

export function buildFileLinkText(
	app: App,
	file: TFile,
	options: FileLinkTextOptions = {},
): string {
	const sourcePath = options.sourcePath ?? "";
	const baseLink = app.fileManager.generateMarkdownLink(file, sourcePath);
	const shouldEmbed =
		options.linkType === "embed" &&
		(!options.placement || placementSupportsEmbed(options.placement));

	return shouldEmbed ? convertLinkToEmbed(baseLink) : baseLink;
}

function hasExplicitExtension(path: string): boolean {
	const fileName = path.split("/").pop() ?? "";
	return /\.[^./\\]+$/.test(fileName);
}

export function normalizeAppendLinkDestinationPath(rawPath: string): string {
	const path = rawPath.trim().replace(/^\/+/, "");
	if (!path) return "";
	return hasExplicitExtension(path) ? path : `${path}.md`;
}

export function getAppendLinkDestinationFile(
	app: App,
	destination: AppendLinkDestination,
): TFile | null {
	if (destination.type !== "specifiedFile") return null;

	const normalizedPath = normalizeAppendLinkDestinationPath(destination.path);
	if (!normalizedPath) return null;

	const target = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(target instanceof TFile) || target.extension !== "md") return null;

	return target;
}

function appendLine(content: string, line: string): string {
	if (content.length === 0) return line;
	return content.endsWith("\n") ? `${content}${line}` : `${content}\n${line}`;
}

export async function appendFileLinkToDestinationFile(
	app: App,
	file: TFile,
	linkOptions: AppendLinkOptions,
): Promise<boolean> {
	const destination = linkOptions.destination;
	if (destination?.type !== "specifiedFile") return false;

	const targetFile = getAppendLinkDestinationFile(app, destination);
	if (!targetFile) {
		throw new Error(
			`Append link target file not found or is not a Markdown file: ${destination.path}`,
		);
	}

	const linkText = buildFileLinkText(app, file, {
		sourcePath: targetFile.path,
		linkType: "link",
	});

	await app.vault.process(targetFile, (content) => appendLine(content, linkText));
	return true;
}

export async function writeTextToClipboard(text: string): Promise<boolean> {
	const clipboard = globalThis.navigator?.clipboard;
	if (!clipboard?.writeText) {
		log.logWarning("QuickAdd: Clipboard API is unavailable.");
		return false;
	}

	try {
		await clipboard.writeText(text);
		return true;
	} catch (error) {
		log.logWarning(
			`QuickAdd: Could not copy link to clipboard: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return false;
	}
}

export async function copyFileLinkToClipboard(
	file: TFile,
): Promise<boolean> {
	const linkText = buildPortableFileLinkText(file);
	const copied = await writeTextToClipboard(linkText);

	if (copied) {
		new Notice(
			`Copied link to '${file.basename}' to clipboard.`,
			CLIPBOARD_NOTICE_DURATION_MS,
		);
		return true;
	}

	new Notice(
		`Created '${file.basename}', but QuickAdd could not copy its link to the clipboard.`,
		CLIPBOARD_NOTICE_DURATION_MS,
	);
	return false;
}
