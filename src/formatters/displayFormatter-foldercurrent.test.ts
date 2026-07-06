import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import type QuickAdd from "../main";

// FormatDisplayFormatter statically imports SingleTemplateEngine, whose module
// graph reaches obsidian-dataview (which requires a real 'obsidian' module).
// The {{foldercurrent}} preview never touches templates, so stub it out.
vi.mock("../engine/SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		run(): Promise<string> {
			return Promise.resolve("");
		}
	},
}));

/**
 * {{foldercurrent}} previews (issue #1480): both display formatters resolve the
 * token through a never-null preview resolver, so a live preview shows the
 * active file's folder (placeholder when none) and can never hit the runtime's
 * missing-active-file throw.
 */

function makeApp(activeFile: unknown): App {
	return {
		workspace: { getActiveFile: () => activeFile },
		vault: { getMarkdownFiles: () => [] },
		metadataCache: { getFileCache: () => null },
	} as unknown as App;
}

const plugin = {
	settings: { globalVariables: {}, choices: [] },
} as unknown as QuickAdd;

const activeInAlpha = {
	basename: "Meeting",
	path: "Projects/Alpha/Meeting.md",
	parent: { path: "Projects/Alpha" },
};

describe("Display formatters - {{foldercurrent}} preview", () => {
	it("file-name preview shows the active file's folder path", async () => {
		const f = new FileNameDisplayFormatter(makeApp(activeInAlpha), plugin);
		await expect(f.format("{{foldercurrent}}/Tasks.md")).resolves.toBe(
			"Projects/Alpha/Tasks.md",
		);
	});

	it("file-name preview shows the leaf for |name", async () => {
		const f = new FileNameDisplayFormatter(makeApp(activeInAlpha), plugin);
		await expect(f.format("{{foldercurrent|name}} note")).resolves.toBe(
			"Alpha note",
		);
	});

	it("file-name preview falls back to a placeholder without an active file (no throw)", async () => {
		const f = new FileNameDisplayFormatter(makeApp(null), plugin);
		await expect(f.format("{{foldercurrent}}/Tasks.md")).resolves.toBe(
			"current_folder/Tasks.md",
		);
	});

	it("body preview resolves the token", async () => {
		const f = new FormatDisplayFormatter(makeApp(activeInAlpha), plugin);
		await expect(f.format("Filed under {{foldercurrent}}")).resolves.toBe(
			"Filed under Projects/Alpha",
		);
	});

	it("line-target preview mode leaves the token literal (matches formatLocationString)", async () => {
		const f = new FormatDisplayFormatter(
			makeApp(activeInAlpha),
			plugin,
			undefined,
			{ resolveActiveFolder: false },
		);
		await expect(f.format("## {{foldercurrent}}")).resolves.toBe(
			"## {{foldercurrent}}",
		);
		// Other note-derived tokens still preview normally in that mode.
		await expect(f.format("{{filenamecurrent}}")).resolves.toBe("Meeting");
	});

	it("previews show a root-level active file's folder as empty (truthful)", async () => {
		const f = new FileNameDisplayFormatter(
			makeApp({ basename: "Root", path: "Root.md", parent: { path: "/" } }),
			plugin,
		);
		await expect(f.format("{{foldercurrent}}/Tasks.md")).resolves.toBe(
			"/Tasks.md",
		);
	});
});
