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

const CLIPBOARD_NOTICE_DURATION_MS = 4000;

type FileLinkTextOptions = {
	sourcePath?: string;
	linkType?: LinkType;
	placement?: LinkPlacement;
	/**
	 * Desired display text (alias) for the link, as raw user text (e.g. the
	 * editor selection). buildFileLinkText owns making it link-safe; text that
	 * cannot be represented safely degrades to a plain, alias-less link.
	 * Ignored for embeds.
	 */
	alias?: string;
};

function usesMarkdownLinks(app: App): boolean {
	// vault.getConfig is the de-facto (untyped) plugin API for editor settings.
	// Inferring the mode from a generated link's shape instead would misdetect
	// markdown-link vaults whose note basename starts with "[".
	const vault = app.vault as App["vault"] & {
		getConfig?: (key: string) => unknown;
	};
	return vault.getConfig?.("useMarkdownLinks") === true;
}

/**
 * Makes raw user text (e.g. an editor selection) safe to use as a link alias,
 * or returns undefined when no (safe) alias can be produced. Obsidian's
 * generateMarkdownLink performs no alias sanitization, so this is QuickAdd's
 * job. Rules verified against Obsidian 1.13's own metadataCache parses:
 *
 * - Newlines never survive inside a link; runs collapse to a single space.
 * - Markdown mode: "\", "[", "]" are escaped (backslash first). Escapes render
 *   display-faithfully, so every alias is representable.
 * - Wiki mode: backslash is NOT an escape character, so unsafe text cannot be
 *   escaped. Single "[", "]", "|" are safe (pipes render literally in the
 *   display). An alias containing "]]" or "[[" (a nested "[[Other]]" hijacks
 *   the outer link's target entirely) or ending with "]" (forms "]]" with the
 *   closing delimiter) is unrepresentable; rather than mutate the user's text,
 *   the alias is dropped and the link stays plain.
 */
function prepareLinkAlias(app: App, rawAlias: string): string | undefined {
	// Single \s+ pass: a lookaround-free single quantifier cannot backtrack
	// quadratically on long horizontal-whitespace runs (the opener-flood ReDoS
	// shape from #1444/#1455/#1462). Only runs containing a newline collapse.
	const alias = rawAlias
		.replace(/\s+/g, (run) => (/[\r\n]/.test(run) ? " " : run))
		.trim();
	if (!alias) return undefined;

	if (usesMarkdownLinks(app)) {
		return alias
			.replace(/\\/g, "\\\\")
			.replace(/\[/g, "\\[")
			.replace(/\]/g, "\\]");
	}

	if (alias.includes("]]") || alias.includes("[[") || alias.endsWith("]")) {
		return undefined;
	}

	return alias;
}

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
	const shouldEmbed =
		options.linkType === "embed" &&
		(!options.placement || placementSupportsEmbed(options.placement));

	if (shouldEmbed) {
		// Embeds are always wiki-style transclusions (`![[...]]`) regardless of the
		// vault's link-format setting, because Obsidian renders `![](...)` as an
		// attachment image, not a note embed. fileToLinktext returns the literal,
		// link-format-aware wikilink text (no percent-encoding), so the embed needs
		// no decoding or delimiter sanitizing.
		return `![[${app.metadataCache.fileToLinktext(file, sourcePath)}]]`;
	}

	// Regular links honor the vault's "New link format" + markdown/wiki setting.
	// When the alias equals the generated link text, Obsidian omits it.
	const alias =
		options.alias === undefined
			? undefined
			: prepareLinkAlias(app, options.alias);
	if (alias === undefined) {
		return app.fileManager.generateMarkdownLink(file, sourcePath);
	}
	return app.fileManager.generateMarkdownLink(
		file,
		sourcePath,
		undefined,
		alias,
	);
}

export function normalizeAppendLinkDestinationPath(rawPath: string): string {
	const path = rawPath.trim().replace(/^\/+/, "");
	if (!path) return "";
	return /\.md$/i.test(path) ? path : `${path}.md`;
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
	// Returns false without surfacing its own Notice so callers own the single
	// user-facing failure message (avoids stacked duplicate notices).
	const clipboard = window.navigator?.clipboard;
	if (!clipboard?.writeText) {
		log.logMessage("QuickAdd: Clipboard API is unavailable.");
		return false;
	}

	try {
		await clipboard.writeText(text);
		return true;
	} catch (error) {
		log.logMessage(
			`QuickAdd: Could not copy link to clipboard: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return false;
	}
}

export async function copyFileLinkToClipboard(file: TFile): Promise<boolean> {
	// Always use a portable full-path wikilink. Clipboard text has no destination
	// note, so honoring the vault's link-format setting (which "Append link" can,
	// because it has a real target) would generate a link relative to an implicit
	// empty source — wrong once pasted into a note in any other folder. A
	// full-path wikilink resolves correctly wherever it is pasted.
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
