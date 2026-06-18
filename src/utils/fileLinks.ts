import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import { log } from "../logger/logManager";
import type { LinkPlacement, LinkType } from "../types/linkPlacement";
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
