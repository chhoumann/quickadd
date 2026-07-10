import { describe, expect, it } from "vitest";
import config from "../obsidian-e2e.config.mjs";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("obsidian-e2e.config.mjs", () => {
	// The runner seeds a freshly provisioned vault's data.json with a minimal
	// subset of the real settings rather than the whole DEFAULT_SETTINGS object -
	// see the comment in obsidian-e2e.config.mjs for why (the AI provider catalog
	// makes the full object large and churny). These tests guard that subset so
	// the seed can't silently reference a setting that no longer exists, and so
	// the `choices` seed stays in sync with the real default.
	it("only seeds keys that exist on the real settings object", () => {
		const settingsKeys = new Set(Object.keys(DEFAULT_SETTINGS));
		for (const key of Object.keys(config.defaultData)) {
			expect(settingsKeys).toContain(key);
		}
	});

	it("seeds choices matching the real DEFAULT_SETTINGS.choices", () => {
		expect(config.defaultData.choices).toEqual(DEFAULT_SETTINGS.choices);
	});

	it("seeds an empty migrations map so a fresh vault re-runs every migration", () => {
		// Intentionally NOT mirrored from DEFAULT_SETTINGS.migrations (which marks
		// migrations as already-applied). An empty map emulates a clean install so
		// the provisioned vault exercises the migration path on first load.
		expect(config.defaultData.migrations).toEqual({});
	});
});
