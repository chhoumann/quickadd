import type { App, TFile } from "obsidian";
import type { IndexedFile } from "./fileIndexTypes";
import { sanitizeHeading } from "./headingSanitizer";
import { normalizeForSearch } from "./normalizeForSearch";

function extractAliases(frontmatter?: Record<string, unknown>): string[] {
	if (!frontmatter) return [];

	const aliases: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		const lowerKey = key.toLowerCase();
		if (lowerKey !== 'alias' && lowerKey !== 'aliases') continue;

		const candidates = typeof value === "string" ? value.split(",") : value;
		if (Array.isArray(candidates)) {
			aliases.push(...candidates
				.filter((alias): alias is string => typeof alias === "string")
				.map(alias => alias.trim()).filter(Boolean));
		}
	}

	return aliases;
}

export function createIndexedFile(app: App, file: TFile, openedAt?: number): IndexedFile {
	const fileCache = app.metadataCache.getFileCache(file);
	const frontmatter = fileCache?.frontmatter;

	const aliases = extractAliases(frontmatter);
	const aliasesNormalized = aliases.map((alias) => normalizeForSearch(alias));

	const headings = (fileCache?.headings ?? []).map(h => sanitizeHeading(h.heading));

	const blockIds: string[] = [];
	if (fileCache?.blocks) {
		for (const block of Object.values(fileCache.blocks)) {
			if (block.id) {
				blockIds.push(block.id);
			}
		}
	}

	const tags = fileCache?.tags?.map(t => t.tag) ?? [];
	if (frontmatter?.tags) {
		const frontmatterTags = Array.isArray(frontmatter.tags)
			? frontmatter.tags
			: [frontmatter.tags];
		tags.push(...frontmatterTags.filter(t => typeof t === 'string'));
	}

	return {
		path: file.path,
		pathNormalized: normalizeForSearch(file.path),
		basename: file.basename,
		basenameNormalized: normalizeForSearch(file.basename),
		aliases,
		aliasesNormalized,
		headings,
		blockIds,
		tags,
		modified: file.stat.mtime,
		openedAt,
		folder: file.parent?.path ?? ""
	};
}
