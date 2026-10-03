import type { App, CliData, TFile } from "obsidian";

/** One `[[` candidate from Obsidian's link suggester: a file, or one of its aliases. */
export interface LinkCandidate {
	path: string;
	mtime: number;
	/** What Obsidian inserts for the file under the vault's link format. */
	linktext: string;
	alias?: string;
	excluded: boolean;
}

export interface SuggestSource {
	/** null when this Obsidian has no `getLinkSuggestions`. */
	linkCandidates(): LinkCandidate[] | null;
	/** Counts keyed by `#tag`. */
	tagCounts(): Record<string, number>;
}

interface MetadataCacheInternals {
	getLinkSuggestions?: () => { file?: TFile | null; alias?: string }[];
	getTags(): Record<string, number>;
	isUserIgnored(path: string): boolean;
	fileToLinktext(file: TFile, sourcePath: string): string;
}

export function obsidianSuggestSource(app: App): SuggestSource {
	const cache = app.metadataCache as unknown as MetadataCacheInternals;
	return {
		linkCandidates: () =>
			cache.getLinkSuggestions?.().flatMap(({ file, alias }) =>
				// Entries without a file are unresolved link targets; there is no file to link to.
				file
					? [{
						path: file.path,
						mtime: file.stat.mtime,
						linktext: cache.fileToLinktext(file, ""),
						alias,
						excluded: cache.isUserIgnored(file.path),
					}]
					: [],
			) ?? null,
		tagCounts: () => cache.getTags(),
	};
}

type SuggestResult = { ok: boolean; [key: string]: unknown };

export function suggestHandler(source: SuggestSource, params: CliData): SuggestResult {
	if (params.kind === "links") {
		const candidates = source.linkCandidates();
		if (!candidates) {
			return { ok: false, error: "This Obsidian version has no link suggestions API; update Obsidian." };
		}
		// getLinkSuggestions has no meaningful order. Obsidian's own suggester
		// shows excluded files less prominently, so they go last.
		const items = [...candidates]
			.sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.mtime - a.mtime)
			.map(({ path, linktext, alias }) =>
				alias === undefined
					? { text: linktext, path }
					: { text: `${linktext}|${alias}`, path, alias },
			);
		return { ok: true, kind: "links", items };
	}

	if (params.kind === "tags") {
		const items = Object.entries(source.tagCounts())
			.map(([tag, count]) => ({ tag: tag.replace(/^#/, ""), count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
		return { ok: true, kind: "tags", items };
	}

	return { ok: false, error: "kind must be links or tags" };
}
