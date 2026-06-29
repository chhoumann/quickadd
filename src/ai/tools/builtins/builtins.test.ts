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
			tools.create_note.execute({ path: "Notes/.obsidian/evil/main.md" }, { toolCallId: "c", toolName: "create_note" }),
		).rejects.toBeInstanceOf(UnsafeVaultPathError);
		expect((app.vault.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
	});

	it("note writers refuse a non-markdown extension (no .js/.css etc.)", async () => {
		const app = makeApp();
		const tools = createVaultTools(app);
		await expect(
			tools.create_note.execute({ path: "Notes/evil.js" }, { toolCallId: "c", toolName: "create_note" }),
		).rejects.toThrow(/markdown/i);
		await expect(
			tools.append_to_note.execute({ path: "Notes/style.css", content: "x" }, { toolCallId: "c", toolName: "append_to_note" }),
		).rejects.toThrow(/markdown/i);
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

// allowedRoots confinement for the workspace group (#714, other-confinement-gap).
// get_active_note/get_selection expose the user's ambient editor state; when a
// script author opts into allowedRoots they expect notes OUTSIDE those folders to
// stay invisible — the vault group already honors this, the workspace group did not.
describe("workspace tools — allowedRoots confinement", () => {
	function mdFile(path: string): TFile {
		const f = Object.create(TFile.prototype) as TFile;
		const basename = path.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
		Object.assign(f, { path, basename, extension: "md" });
		return f;
	}
	function appWithActive(path: string, content: string, cachedRead = vi.fn(async () => content)) {
		return makeApp({
			vault: { cachedRead },
			workspace: { getActiveFile: () => mdFile(path) },
		});
	}
	function appWithSelection(filePath: string | null, selection: string) {
		const view = {
			file: filePath === null ? null : mdFile(filePath),
			editor: { getSelection: () => selection },
		};
		return makeApp({ workspace: { getActiveViewOfType: () => view } });
	}
	const call = (tools: ReturnType<typeof createWorkspaceTools>, name: "get_active_note" | "get_selection") =>
		tools[name].execute({}, { toolCallId: "c", toolName: name });

	describe("get_active_note", () => {
		it("hides the active note (and skips the read) when it is OUTSIDE the roots", async () => {
			const cachedRead = vi.fn(async () => "TOP SECRET");
			const app = appWithActive("Secret/passwords.md", "TOP SECRET", cachedRead);
			const tools = createWorkspaceTools(app, { allowedRoots: ["AI"] });
			expect(await call(tools, "get_active_note")).toEqual({ active: null });
			// Confinement must short-circuit before any content is read.
			expect(cachedRead).not.toHaveBeenCalled();
		});
		it("returns the note when it is INSIDE the roots", async () => {
			const app = appWithActive("AI/scratch.md", "# in scope");
			const tools = createWorkspaceTools(app, { allowedRoots: ["AI"] });
			const res = (await call(tools, "get_active_note")) as { active: { path: string; content: string } | null };
			expect(res.active).toMatchObject({ path: "AI/scratch.md", content: "# in scope" });
		});
		it("is NOT fooled by a sibling whose path shares the root prefix", async () => {
			const app = appWithActive("AInotes/leak.md", "leak");
			const tools = createWorkspaceTools(app, { allowedRoots: ["AI"] });
			expect(await call(tools, "get_active_note")).toEqual({ active: null });
		});
		it("is NOT fooled by a leading-space sibling folder (path compared by identity)", async () => {
			const cachedRead = vi.fn(async () => "TOP SECRET");
			const app = appWithActive(" AI/secret.md", "TOP SECRET", cachedRead);
			const tools = createWorkspaceTools(app, { allowedRoots: ["AI"] });
			expect(await call(tools, "get_active_note")).toEqual({ active: null });
			expect(cachedRead).not.toHaveBeenCalled();
		});
		it("default (no roots) returns the note unchanged regardless of folder", async () => {
			const app = appWithActive("Secret/passwords.md", "TOP SECRET");
			const tools = createWorkspaceTools(app);
			const res = (await call(tools, "get_active_note")) as { active: { path: string } | null };
			expect(res.active).toMatchObject({ path: "Secret/passwords.md" });
		});
		it("all-blank roots behave identically to no roots (vault-wide)", async () => {
			for (const allowedRoots of [[""], ["  "]]) {
				const app = appWithActive("Secret/passwords.md", "TOP SECRET");
				const tools = createWorkspaceTools(app, { allowedRoots });
				const res = (await call(tools, "get_active_note")) as { active: { path: string } | null };
				expect(res.active).toMatchObject({ path: "Secret/passwords.md" });
			}
		});
	});

	describe("get_selection", () => {
		it("returns empty when the active view's file is OUTSIDE the roots", async () => {
			const app = appWithSelection("Secret/passwords.md", "secret highlight");
			const tools = createWorkspaceTools(app, { allowedRoots: ["AI"] });
			expect(await call(tools, "get_selection")).toEqual({ selection: "" });
		});
		it("returns the selection when the active view's file is INSIDE the roots", async () => {
			const app = appWithSelection("AI/scratch.md", "in-scope highlight");
			const tools = createWorkspaceTools(app, { allowedRoots: ["AI"] });
			expect(await call(tools, "get_selection")).toEqual({ selection: "in-scope highlight" });
		});
		it("denies a confined view whose file is null (deferred/empty view)", async () => {
			const app = appWithSelection(null, "orphan selection");
			const tools = createWorkspaceTools(app, { allowedRoots: ["AI"] });
			expect(await call(tools, "get_selection")).toEqual({ selection: "" });
		});
		it("default (no roots) returns the selection regardless of folder", async () => {
			const app = appWithSelection("Secret/passwords.md", "secret highlight");
			const tools = createWorkspaceTools(app);
			expect(await call(tools, "get_selection")).toEqual({ selection: "secret highlight" });
		});
	});
});

// allowedRoots confinement for the vault READ group (#714, other-confinement-bypass).
// list_notes/search_notes/get_property_values filter app-owned TFile.path against the
// fence. A TFile.path is an IDENTITY, so the filter must compare it without trimming or
// re-spelling — otherwise a sibling folder named " AI" (leading space) trims to "AI" and
// masquerades as the allowed root, leaking out-of-fence paths/snippets/frontmatter into
// the LLM transcript. (Same class the workspace group fixed in #1432; a leading-space
// folder is creatable in Obsidian and getMarkdownFiles() preserves the space — verified
// live.)
describe("vault read tools — allowedRoots confinement is identity-preserving", () => {
	const ctx = (name: string) => ({ toolCallId: "c", toolName: name });

	// A real leading-space sibling folder " AI" alongside the allowed root "AI".
	const SIBLING = fileLike(" AI/secret.md", "secret");
	const INROOT = fileLike("AI/ok.md", "ok");

	it("list_notes (no folder) excludes a leading-space sibling of the root", async () => {
		const app = makeApp({ vault: { getMarkdownFiles: () => [SIBLING, INROOT] } });
		const tools = createVaultTools(app, { allowedRoots: ["AI"] });
		const res = (await tools.list_notes.execute({}, ctx("list_notes"))) as {
			total: number;
			notes: Array<{ path: string }>;
		};
		expect(res.notes.map((n) => n.path)).toEqual(["AI/ok.md"]);
		expect(res.total).toBe(1);
	});

	it("search_notes excludes a leading-space sibling of the root", async () => {
		const cachedRead = vi.fn(async (f: TFile) => (f.path === " AI/secret.md" ? "needle" : "haystack"));
		const app = makeApp({ vault: { getMarkdownFiles: () => [SIBLING, INROOT], cachedRead } });
		const tools = createVaultTools(app, { allowedRoots: ["AI"] });
		const res = (await tools.search_notes.execute(
			{ query: "needle", in: "content" },
			ctx("search_notes"),
		)) as { results: Array<{ path: string }> };
		expect(res.results.map((r) => r.path)).toEqual([]);
		// The out-of-fence sibling must never be read for content.
		expect(cachedRead).not.toHaveBeenCalledWith(SIBLING);
	});

	it("get_property_values (no folder) excludes a leading-space sibling of the root", async () => {
		const getFileCache = vi.fn((f: TFile) => ({
			frontmatter: { status: f.path === " AI/secret.md" ? "LEAKED" : "ok" },
		}));
		const app = makeApp({
			vault: { getMarkdownFiles: () => [SIBLING, INROOT] },
			metadataCache: { getFileCache },
		});
		const tools = createVaultTools(app, { allowedRoots: ["AI"] });
		const res = (await tools.get_property_values.execute(
			{ field: "status" },
			ctx("get_property_values"),
		)) as { values: string[] };
		expect(res.values).toEqual(["ok"]);
	});

	it("default (no roots) lists every folder unchanged", async () => {
		const app = makeApp({ vault: { getMarkdownFiles: () => [SIBLING, INROOT] } });
		const tools = createVaultTools(app);
		const res = (await tools.list_notes.execute({}, ctx("list_notes"))) as {
			notes: Array<{ path: string }>;
		};
		expect(res.notes.map((n) => n.path).sort()).toEqual([" AI/secret.md", "AI/ok.md"]);
	});
});
