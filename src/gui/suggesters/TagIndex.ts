import Fuse, { type FuseResult } from "fuse.js";
import type { App, Plugin } from "obsidian";

const FUSE_OPTIONS = {
	threshold: 0.4,
	includeScore: true,
	keys: [""],
};

/**
 * Shared, vault-wide tag index. One instance per plugin load (mirrors the
 * {@link FileIndex} singleton): it builds the sorted tag list + Fuse index once
 * and registers the metadataCache `resolved` listener EXACTLY ONCE via
 * `plugin.registerEvent` - plugin-lifetime cleanup, which is correct for a
 * singleton that itself lives for the plugin's lifetime.
 *
 * Per-prompt `TagSuggester`s read from this singleton instead of each building
 * their own Fuse index and registering their own plugin-lifetime listener. The
 * old per-instance approach leaked one `TagSuggester` (and its full tag Fuse
 * index) for every opened input prompt - the listener closure pinned the
 * instance for the rest of the session - and amplified every `resolved` event
 * into one redundant rebuild per leaked instance.
 */
export class TagIndex {
	protected static instance: TagIndex;
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
	 * Rebuilds the sorted tag list + Fuse index from the live metadata cache.
	 * Called once on construction, on every `resolved` event, and on each prompt
	 * open (so a newly-opened prompt always sees current tags, matching the old
	 * per-instance behavior without the per-instance listener).
	 */
	refresh(): void {
		// @ts-expect-error - getTags is available but not in the type definitions
		const tagObj = this.app.metadataCache.getTags() as Record<string, number>;
		const tags = Object.keys(tagObj);

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
