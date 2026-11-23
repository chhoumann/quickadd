import Fuse, { type FuseResult } from "fuse.js";
import type { App, Plugin } from "obsidian";
import { getMetadataCacheTags } from "../obsidianInternals";

const FUSE_OPTIONS = {
	threshold: 0.4,
	includeScore: true,
	keys: [""],
};

/**
 * Shared vault-wide tag index, one per plugin load like {@link FileIndex}. It
 * builds the sorted tag list and Fuse index once and registers its `resolved`
 * listener once, so per-prompt TagSuggesters never each pin their own index for
 * the rest of the session.
 */
export class TagIndex {
	private static instance: TagIndex | undefined;
	private app: App;
	private sortedTags: string[] = [];
	private fuse: Fuse<string> = new Fuse<string>([], FUSE_OPTIONS);

	protected constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.refresh();

		// Keep the index fresh as the vault's tags change. registerEvent ties the
		// listener to plugin unload, matching this singleton's lifetime.
		plugin.registerEvent(
			this.app.metadataCache.on("resolved", () => this.refresh()),
		);
	}

	static getInstance(app: App, plugin: Plugin): TagIndex {
		if (!TagIndex.instance) {
			TagIndex.instance = new TagIndex(app, plugin);
		}
		return TagIndex.instance;
	}

	/**
	 * Drops the singleton. Its `resolved` listener goes with the plugin's own
	 * registerEvent cleanup on unload.
	 */
	static destroyInstance(): void {
		TagIndex.instance = undefined;
	}

	/**
	 * Rebuilds the sorted tag list and Fuse index from the live metadata cache:
	 * on construction, on every `resolved` event, and on each prompt open, so a
	 * newly opened prompt always sees current tags.
	 */
	refresh(): void {
		const tags = Object.keys(getMetadataCacheTags(this.app) ?? {});

		// Sort: shorter tags first, then alphabetically (stable, query-independent).
		this.sortedTags = tags.sort((a, b) => {
			if (a.length !== b.length) {
				return a.length - b.length;
			}
			return a.localeCompare(b);
		});

		this.fuse = new Fuse<string>(this.sortedTags, FUSE_OPTIONS);
	}

	/** All vault tags, sorted shortest-first then alphabetically. */
	getSortedTags(): string[] {
		return this.sortedTags;
	}

	/** Fuzzy tag search; callers filter by score and slice as they need. */
	search(query: string): FuseResult<string>[] {
		return this.fuse.search(query);
	}
}
