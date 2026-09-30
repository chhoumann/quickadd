import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleErrorLogger } from "./consoleErrorLogger";

describe("QuickAddLogger output", () => {
	afterEach(() => vi.restoreAllMocks());

	it.each([
		["a plain message", "Could not save 'a.md' yet", "Could not save 'a.md' yet"],
		[
			"a message with its own brand",
			"QuickAdd: |format: needs |multi in \"{{FIELD:x}}\"; ignoring.",
			"|format: needs |multi in \"{{FIELD:x}}\"; ignoring.",
		],
		[
			"a bracketed template report",
			"[QuickAdd: Template inclusion cycle: a.md -> a.md]",
			"Template inclusion cycle: a.md -> a.md",
		],
	])("names QuickAdd once for %s", (_name, message, shown) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		new ConsoleErrorLogger().logWarning(message);
		expect(warn.mock.calls[0][0]).toBe(`QuickAdd: (WARNING) ${shown}`);
	});
});
