import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { applyGroupOptions, defineTool } from "./shared";
import { createVaultTools } from "./vaultTools";
import { createWorkspaceTools } from "./workspaceTools";
import { createSystemTools } from "./systemTools";
import { UnsafeVaultPathError } from "../sanitizeVaultPath";
import type { App } from "obsidian";

function fileLike(path: string, basename = path): TFile {
	const f = Object.create(TFile.prototype) as TFile;
	Object.assign(f, { path, basename });
	return f;
}

function makeApp(over: Record<string, unknown> = {}): App {
	return {
		vault: {
			adapter: {}, // not a FileSystemAdapter → symlink guard is a no-op in tests
			getAbstractFileByPath: vi.fn(() => null),
			getMarkdownFiles: vi.fn(() => []),
			cachedRead: vi.fn(async () => ""),
			read: vi.fn(async () => ""),
			create: vi.fn(async (p: string) => fileLike(p)),
			modify: vi.fn(async () => undefined),
			createFolder: vi.fn(async () => undefined),
			...((over.vault as object) ?? {}),
		},
		metadataCache: { getFileCache: vi.fn(() => null), ...((over.metadataCache as object) ?? {}) },
		workspace: { getActiveFile: vi.fn(() => null), getActiveViewOfType: vi.fn(() => null), ...((over.workspace as object) ?? {}) },
	} as unknown as App;
}

describe("applyGroupOptions", () => {
	const set = {
		a: defineTool({ description: "a", inputSchema: { type: "object" }, execute: async () => 1 }),
		b: defineTool({ description: "b", inputSchema: { type: "object" }, execute: async () => 2 }),
	};
	it("only / exclude / prefix", () => {
		expect(Object.keys(applyGroupOptions(set, { only: ["a"] }))).toEqual(["a"]);
		expect(Object.keys(applyGroupOptions(set, { exclude: ["a"] }))).toEqual(["b"]);
		expect(Object.keys(applyGroupOptions(set, { prefix: "qa_" }))).toEqual(["qa_a", "qa_b"]);
	});
	it("prefix keeps each tool's needsApproval/readOnly intact", () => {
		const writer = { w: defineTool({ description: "w", inputSchema: { type: "object" }, needsApproval: true, execute: async () => 1 }) };
		const renamed = applyGroupOptions(writer, { prefix: "p_" });
		expect(renamed.p_w.needsApproval).toBe(true);
	});
});

describe("vault tools — classification + schemas", () => {
	const tools = createVaultTools(makeApp());
	it("read tools are readOnly, write tools need approval", () => {
		for (const r of ["read_note", "list_notes", "search_notes", "get_property_values"]) {
			expect(tools[r].readOnly).toBe(true);
		}
		for (const w of ["create_note", "append_to_note", "insert_under_heading"]) {
			expect(tools[w].needsApproval).toBe(true);
		}
	});
	it("does NOT ship the deferred high-risk tools", () => {
		for (const deferred of ["run_choice", "apply_template", "set_frontmatter_property", "delete_note"]) {
			expect(tools[deferred]).toBeUndefined();
		}
	});
});

describe("vault write tools — safety", () => {
	it("create_note rejects an unsafe (config-dir) path before touching the vault", async () => {
		const app = makeApp();
		const tools = createVaultTools(app);
		await expect(
			tools.create_note.execute({ path: "Notes/.obsidian/evil/main.js" }, { toolCallId: "c", toolName: "create_note" }),
		).rejects.toBeInstanceOf(UnsafeVaultPathError);
		expect((app.vault.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
	});

	it("create_note ensures .md and calls vault.create (fail-on-exist via the API)", async () => {
		const create = vi.fn(async (p: string) => fileLike(p));
		const app = makeApp({ vault: { create, getAbstractFileByPath: () => fileLike("Notes") } });
		const tools = createVaultTools(app);
		const res = (await tools.create_note.execute({ path: "Notes/New", content: "hi" }, { toolCallId: "c", toolName: "create_note" })) as { created: boolean; path: string };
		expect(create).toHaveBeenCalledWith("Notes/New.md", "hi");
		expect(res).toMatchObject({ created: true, path: "Notes/New.md" });
	});

	it("append_to_note errors when the note does not exist", async () => {
		const app = makeApp({ vault: { getAbstractFileByPath: () => null } });
		const tools = createVaultTools(app);
		await expect(
			tools.append_to_note.execute({ path: "Missing.md", content: "x" }, { toolCallId: "c", toolName: "append_to_note" }),
		).rejects.toThrow(/not found/i);
	});

	it("respects allowedRoots for reads", async () => {
		const app = makeApp();
		const tools = createVaultTools(app, { allowedRoots: ["AI"] });
		await expect(
			tools.read_note.execute({ path: "Secret/passwords.md" }, { toolCallId: "c", toolName: "read_note" }),
		).rejects.toBeInstanceOf(UnsafeVaultPathError);
	});
});

describe("workspace + system tools", () => {
	it("get_selection returns empty string when no active editor", async () => {
		const tools = createWorkspaceTools(makeApp());
		expect(await tools.get_selection.execute({}, { toolCallId: "c", toolName: "get_selection" })).toEqual({ selection: "" });
	});
	it("get_active_note returns active:null when there is no active file", async () => {
		const tools = createWorkspaceTools(makeApp());
		expect(await tools.get_active_note.execute({}, { toolCallId: "c", toolName: "get_active_note" })).toEqual({ active: null });
	});
	it("get_date returns a date string", async () => {
		const tools = createSystemTools();
		const res = (await tools.get_date.execute({ format: "YYYY" }, { toolCallId: "c", toolName: "get_date" })) as { date: string };
		expect(typeof res.date).toBe("string");
		expect(res.date.length).toBeGreaterThan(0);
	});
});
