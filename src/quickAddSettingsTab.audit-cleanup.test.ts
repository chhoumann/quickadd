import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { QuickAddSettingsTab } from "./quickAddSettingsTab";
import type QuickAdd from "./main";

// Importing the settings tab transitively pulls in ChoiceView -> the Dataview
// integration, whose compiled CJS does a bare `require('obsidian')` that the
// vitest alias can't intercept. Mock it as the sibling settings tests do.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

function makeTab(): QuickAddSettingsTab {
	const app = new App();
	const plugin = { app } as unknown as QuickAdd;
	return new QuickAddSettingsTab(app, plugin);
}

function findUriToggleDesc(tab: QuickAddSettingsTab): string {
	const groups = tab.getSettingDefinitions() as unknown as Array<{
		items?: Array<{ desc?: unknown; control?: { key?: string } }>;
	}>;

	for (const group of groups) {
		for (const item of group.items ?? []) {
			if (item.control?.key === "enableUriCallbacks") {
				expect(typeof item.desc).toBe("string");
				return item.desc as string;
			}
		}
	}

	throw new Error("Could not find the enableUriCallbacks toggle definition");
}

describe("URI x-callback toggle description", () => {
	it("notes that x-* callbacks restrict a URI to Template/Capture choices", () => {
		const desc = findUriToggleDesc(makeTab());

		// The runtime warning half (main.ts) skips non-Template/Capture choices
		// when x-* params are present; the toggle copy must surface that limit.
		expect(desc).toContain("Template");
		expect(desc).toContain("Capture");
		expect(desc.toLowerCase()).toContain("x-*");
		expect(desc.toLowerCase()).toMatch(/restrict/);
	});
});
