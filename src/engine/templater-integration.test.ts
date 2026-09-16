import { beforeEach, describe, expect, it, vi } from "vitest";
import { templateHarness } from "../../tests/helpers/engines/templateHarness";
import type * as UtilityObsidian from "../utilityObsidian";
import { overwriteTemplaterOnce } from "../utilityObsidian";

vi.mock("../main", () => ({ default: class { } }));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class { } }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("../utilityObsidian", async (original) => ({
	...await original<typeof UtilityObsidian>(),
	overwriteTemplaterOnce: vi.fn(),
}));

function setup(values: Record<string, unknown> = {}, enabled = true, suffix = "<% tp.date.now() %>") {
	const h = templateHarness(enabled);
	const template = `---\n${Object.keys(values).map((key) => `${key}: {{VALUE:${key}}}`).join("\n")}\n---\n${suffix}`;
	h.file("template.md", template);
	for (const [key, value] of Object.entries(values)) h.executor.variables.set(key, value);
	const seen = vi.fn();
	vi.mocked(overwriteTemplaterOnce).mockImplementation(async (_app, file) => {
		h.events.push("templater");
		seen(h.frontmatter(file), h.contents.get(file.path));
		await h.vault.modify(file, (h.contents.get(file.path) ?? "").replace(/<%[^%]*%>/g, "2025-01-01"));
	});
	return { ...h, seen };
}

describe("Production template engine Templater boundary", () => {
	beforeEach(() => vi.clearAllMocks());

	it("should process in correct order: collect, format, create, post-process, Templater", async () => {
		const h = setup({ tags: ["one", "two"] });
		const file = await h.engine.create("note.md", "template.md");
		expect(file).not.toBeNull();
		expect(h.events).toEqual(["create", "properties", "templater", "modify"]);
		expect(h.vault.create).toHaveBeenCalledWith("note.md", expect.not.stringContaining("{{VALUE:"));
		expect(h.seen).toHaveBeenCalledWith({ tags: ["one", "two"] }, expect.stringContaining('<% tp.date.now() %>'));
	});

	it("should call Templater exactly once", async () => {
		const h = setup({ count: 1 });
		const file = await h.engine.create("note.md", "template.md");
		expect(overwriteTemplaterOnce).toHaveBeenCalledExactlyOnceWith(h.app, file);
	});

	it.each([
		["should maintain array structure after Templater processing", { tags: ["work", "project", "important"] }],
		["should maintain nested object structure after Templater processing", { metadata: { author: "Test", settings: { nested: true }, list: [1, 2] } }],
		["should maintain Date objects after Templater processing", { created: new Date("2025-01-01") }],
		["should maintain mixed types (arrays, objects, primitives) after Templater", { tags: ["tag"], config: { key: "value" }, count: 42, active: true }],
	] satisfies [string, Record<string, unknown>][])("%s", async (_name, values) => {
		const h = setup(values);
		const file = await h.engine.create("note.md", "template.md");
		expect(file).not.toBeNull();
		expect(h.seen).toHaveBeenCalledWith(values, expect.any(String));
		if (!file) throw new Error("Template creation failed");
		for (const [key, value] of Object.entries(values)) expect(h.frontmatter(file)[key], key).toEqual(value);
		expect(h.contents.get(file.path)).not.toContain("<%");
	});

	it("should not break YAML formatting when Templater processes content", async () => {
		const h = setup({ tags: ["one", "two"], metadata: { key: "value" } });
		await h.engine.create("note.md", "template.md");
		expect(h.contents.get("note.md")).toBe('---\ntags: ["one","two"]\nmetadata: {"key":"value"}\n---\n2025-01-01');
	});

	it("should handle empty arrays without breaking YAML", async () => {
		const h = setup({ empty: [] });
		await h.engine.create("note.md", "template.md");
		expect(h.processFrontMatter).not.toHaveBeenCalled();
		expect(h.contents.get("note.md")).toBe("---\nempty: \n---\n2025-01-01");
	});

	it("should handle when Templater is not available", async () => {
		const h = setup({ tags: ["tag"] });
		const actual = await vi.importActual<typeof UtilityObsidian>("../utilityObsidian");
		vi.mocked(overwriteTemplaterOnce).mockImplementation(actual.overwriteTemplaterOnce);
		const file = await h.engine.create("note.md", "template.md");
		expect(file).not.toBeNull();
		expect(h.contents.get("note.md")).toContain("<% tp.date.now() %>");
		expect(h.processFrontMatter).toHaveBeenCalledOnce();
	});

	it("should handle Templater syntax in front matter", async () => {
		const h = setup({ tags: ["tag"] });
		h.contents.set("template.md", '---\ntags: {{VALUE:tags}}\ncreated: <% tp.date.now() %>\n---\nBody');
		await h.engine.create("note.md", "template.md");
		expect(h.seen).toHaveBeenCalledWith({ tags: ["tag"], created: "<% tp.date.now() %>" }, expect.any(String));
		expect(h.contents.get("note.md")).toContain('created: "2025-01-01"');
	});

	it("keeps native containers when feature flag is disabled", async () => {
		const h = setup({ tags: ["tag"] }, false);
		await h.engine.create("note.md", "template.md");
		expect(h.processFrontMatter).toHaveBeenCalledOnce();
		expect(h.seen).toHaveBeenCalledWith({ tags: ["tag"] }, expect.any(String));
	});

	it("should handle complex Templater syntax with structured variables", async () => {
		const h = setup({ tags: ["tag"], settings: { count: 2 } }, true,
			'<%* if (true) { tR += "ok"; } %>\n<% tp.date.tomorrow() %>');
		await h.engine.create("note.md", "template.md");
		expect(h.seen).toHaveBeenCalledWith({ tags: ["tag"], settings: { count: 2 } }, expect.stringContaining('<%* if (true)'));
		expect(h.contents.get("note.md")).not.toContain("<%");
	});

	it("should ensure post-processed YAML is available when Templater runs", async () => {
		const h = setup({ tags: ["one", "two"], count: 42 });
		const file = h.file("note.md", "old");
		await h.engine.overwrite(file, "template.md");
		expect(h.events).toEqual(["modify", "properties", "templater", "modify"]);
		expect(h.seen).toHaveBeenCalledWith({ tags: ["one", "two"], count: 42 }, expect.any(String));
		expect(overwriteTemplaterOnce).toHaveBeenCalledExactlyOnceWith(h.app, file);
	});
});
