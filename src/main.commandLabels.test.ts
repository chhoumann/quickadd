import { describe, expect, it } from "vitest";
import { QUICK_ADD_COMMAND_LABELS } from "./commandLabels";

describe("QuickAdd command labels", () => {
	it("keeps built-in command labels free of the plugin name", () => {
		expect(QUICK_ADD_COMMAND_LABELS).toEqual({
			run: "Run",
			runTemplateFromFolder: "New note from template",
			applyTemplate: "Apply template to active note",
			reloadDev: "Reload (dev)",
			openSettings: "Open settings",
			resumePrompt: "Return to prompt",
		});

		for (const label of Object.values(QUICK_ADD_COMMAND_LABELS)) {
			expect(label).not.toContain("QuickAdd");
		}
	});
});
