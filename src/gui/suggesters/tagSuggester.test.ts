import { describe, it, expect, beforeEach, vi } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import { TagSuggester } from "./tagSuggester";
import { TagIndex } from "./TagIndex";

// Reset the shared singleton between tests so each starts from a clean index.
class TestableTagIndex extends TagIndex {
	static reset(): void {
		TagIndex.instance = undefined as unknown as TagIndex;
	}
}

type ResolvedCb = () => void;

function makeApp(
	tags: Record<string, number>,
	resolvedCbs: ResolvedCb[],
): App {
	return {
		metadataCache: {
			getTags: vi.fn(() => tags),
			on: vi.fn((event: string, cb: ResolvedCb) => {
				if (event === "resolved") resolvedCbs.push(cb);
				return {} as never;
			}),
			offref: vi.fn(),
		},
		workspace: { on: vi.fn(() => ({})) },
		vault: { on: vi.fn(() => ({})) },
	} as unknown as App;
}

describe("TagSuggester shares one tag index across prompts (no per-prompt listener leak)", () => {
	let app: App;
	let resolvedCbs: ResolvedCb[];
	let registerEvent: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		TestableTagIndex.reset();
		resolvedCbs = [];
		app = makeApp({ "#a": 1, "#bb": 2, "#ccc": 3 }, resolvedCbs);
		registerEvent = vi.fn((ref) => ref);
		setQuickAddInstance({ registerEvent } as unknown as QuickAdd);
	});

	// Each prompt builds a brand-new input element (its own per-input instanceMap),
	// exactly like GenericInputPrompt does, so the constructor dedup never
	// collapses suggesters across prompts.
	const openPrompt = () =>
		new TagSuggester(app, document.createElement("input"));

	it("registers exactly one metadataCache 'resolved' listener for many prompts", () => {
		for (let i = 0; i < 5; i++) openPrompt();

		const resolvedRegistrations = (
			app.metadataCache.on as ReturnType<typeof vi.fn>
		).mock.calls.filter(([event]) => event === "resolved");

		// Old per-instance code registered one listener per prompt (5); the shared
		// index registers exactly one, plugin-lifetime, for the whole session.
		expect(resolvedRegistrations).toHaveLength(1);
		expect(registerEvent).toHaveBeenCalledTimes(1);
	});

	it("a single 'resolved' event triggers exactly one rebuild, not one per prompt", () => {
		for (let i = 0; i < 4; i++) openPrompt();

		const getTags = (
			app.metadataCache as unknown as { getTags: ReturnType<typeof vi.fn> }
		).getTags;
		getTags.mockClear();

		// Simulate the metadataCache dispatching 'resolved' to ALL its registered
		// listeners (what Obsidian does on startup/edit/sync). Old code amplified
		// this into one refreshTagIndex() per leaked instance.
		for (const cb of resolvedCbs) cb();

		expect(getTags).toHaveBeenCalledTimes(1);
	});

	it("reflects new tags on the next prompt open without a 'resolved' event", () => {
		openPrompt(); // builds the shared index from the initial tags

		// The vault gains a tag, but no 'resolved' event has fired yet.
		(
			app.metadataCache as unknown as { getTags: ReturnType<typeof vi.fn> }
		).getTags.mockReturnValue({ "#a": 1, "#bb": 2, "#ccc": 3, "#fresh": 1 });

		// Opening a new prompt refreshes the shared index, so it sees the new tag
		// immediately - matching the old per-prompt freshness without the leak.
		const suggester = openPrompt();
		const input = (suggester as unknown as { inputEl: HTMLInputElement }).inputEl;
		input.value = "#fre";
		input.setSelectionRange(4, 4);

		expect(suggester.getSuggestions("#fre")).toContain("#fresh");
	});
});

describe("TagSuggester getSuggestions (behavior-preserving over the shared index)", () => {
	beforeEach(() => {
		TestableTagIndex.reset();
		setQuickAddInstance({
			registerEvent: vi.fn((ref) => ref),
		} as unknown as QuickAdd);
	});

	const suggesterFor = (tags: Record<string, number>): TagSuggester => {
		const app = makeApp(tags, []);
		return new TagSuggester(app, document.createElement("input"));
	};

	it("surfaces matching #-prefixed tags and excludes non-matches", () => {
		// Real Obsidian tags carry the leading '#'; getSuggestions strips it from
		// the query, so matching runs through the Fuse path (verified live too).
		const suggester = suggesterFor({ "#alpha": 1, "#alpine": 1, "#beta": 1 });
		const input = (suggester as unknown as { inputEl: HTMLInputElement })
			.inputEl;
		input.value = "#alp";
		input.setSelectionRange(4, 4);

		const out = suggester.getSuggestions("#alp");

		expect(out).toContain("#alpha");
		expect(out).toContain("#alpine");
		expect(out).not.toContain("#beta");
		expect(out.length).toBeLessThanOrEqual(15); // combined cap preserved
	});

	it("returns nothing when the cursor is inside a wikilink", () => {
		const suggester = suggesterFor({ "#tag": 1 });
		const input = (suggester as unknown as { inputEl: HTMLInputElement })
			.inputEl;
		const value = "[[Note#tag";
		input.value = value;
		input.setSelectionRange(value.length, value.length);

		expect(suggester.getSuggestions(value)).toEqual([]);
	});
});
