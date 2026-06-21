import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { applyGroupOptions, defineTool } from "./shared";
import { createWorkspaceTools } from "./workspaceTools";
import { log } from "src/logger/logManager";

function makeApp(over: Record<string, unknown> = {}): App {
	return {
		vault: {
			cachedRead: vi.fn(async () => "binary-bytes"),
			...((over.vault as object) ?? {}),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => null),
			...((over.workspace as object) ?? {}),
		},
	} as unknown as App;
}

function fileLike(path: string, extension: string): TFile {
	const f = Object.create(TFile.prototype) as TFile;
	const basename = path.replace(/\.[^.]+$/, "");
	Object.assign(f, { path, basename, extension });
	return f;
}

describe("ai-tools-builtin-workspace: get_active_note markdown guard", () => {
	it("returns active:null when the active file is NOT markdown (PDF/image/canvas)", async () => {
		const pdf = fileLike("Docs/paper.pdf", "pdf");
		const cachedRead = vi.fn(async () => "%PDF-1.7 binary…");
		const app = makeApp({
			vault: { cachedRead },
			workspace: { getActiveFile: () => pdf },
		});
		const tools = createWorkspaceTools(app);
		const res = await tools.get_active_note.execute(
			{},
			{ toolCallId: "c", toolName: "get_active_note" },
		);
		// Before the fix this read the PDF bytes back as active.content.
		expect(res).toEqual({ active: null });
		expect(cachedRead).not.toHaveBeenCalled();
	});

	it("still returns markdown content when a .md note is active", async () => {
		const note = fileLike("Notes/Foo.md", "md");
		const app = makeApp({
			vault: { cachedRead: vi.fn(async () => "# hi") },
			workspace: { getActiveFile: () => note },
		});
		const tools = createWorkspaceTools(app);
		const res = (await tools.get_active_note.execute(
			{},
			{ toolCallId: "c", toolName: "get_active_note" },
		)) as { active: { path: string; content: string } | null };
		expect(res.active).toMatchObject({ path: "Notes/Foo.md", content: "# hi" });
	});
});

describe("api-ai-builtin-tools-vault: only/exclude warn on unknown names", () => {
	const set = {
		read_note: defineTool({ description: "r", inputSchema: { type: "object" }, execute: async () => 1 }),
		create_note: defineTool({ description: "c", inputSchema: { type: "object" }, execute: async () => 2 }),
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("warns naming the unknown tool and the valid names when `only` has a typo", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		// 'read_notes' is a typo for 'read_note' → empty map, silent before the fix.
		const result = applyGroupOptions(set, { only: ["read_notes"] });
		expect(Object.keys(result)).toEqual([]);
		expect(warn).toHaveBeenCalledTimes(1);
		const msg = warn.mock.calls[0][0] as string;
		expect(msg).toContain("read_notes");
		expect(msg).toContain("read_note");
		expect(msg).toContain("create_note");
	});

	it("warns when `exclude` names a tool that is not in the group", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		const result = applyGroupOptions(set, { exclude: ["delete_note"] });
		// exclude typo leaves the tool in (the silent failure the finding describes).
		expect(Object.keys(result)).toEqual(["read_note", "create_note"]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0] as string).toContain("delete_note");
	});

	it("does NOT warn when only/exclude entries all match", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		applyGroupOptions(set, { only: ["read_note"], exclude: ["create_note"] });
		expect(warn).not.toHaveBeenCalled();
	});
});
