// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { QuickAddSettingsTab } from "./quickAddSettingsTab";
import type QuickAdd from "./main";

function makeTab(): QuickAddSettingsTab {
	const app = new App();
	const plugin = { app, register: vi.fn() } as unknown as QuickAdd;
	return new QuickAddSettingsTab(app, plugin);
}

type Node = { desc?: unknown; control?: { key?: string }; items?: Node[] };

function findUriToggleDesc(tab: QuickAddSettingsTab): string {
	// The toggle lives on the Advanced page, so walk into pages too.
	const find = (nodes: Node[]): Node | undefined => {
		for (const node of nodes) {
			if (node.control?.key === "enableUriCallbacks") return node;
			const nested = find(node.items ?? []);
			if (nested) return nested;
		}
	};
	const item = find(tab.getSettingDefinitions() as unknown as Node[]);
	if (!item) throw new Error("Could not find the enableUriCallbacks toggle definition");
	expect(typeof item.desc).toBe("string");
	return item.desc as string;
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
