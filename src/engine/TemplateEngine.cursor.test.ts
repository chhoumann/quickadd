import type * as UtilityObsidian from "../utilityObsidian";
import { WorkspaceLeaf, type MarkdownView, type EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { templateHarness } from "../../tests/helpers/engines/templateHarness";
import { TemplateInsertEngine } from "./TemplateInsertEngine";
import { overwriteTemplaterOnce, templaterParseTemplate } from "../utilityObsidian";

vi.mock("../main", () => ({ default: class {} }));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("../utilityObsidian", async importOriginal => ({
	...await importOriginal<typeof UtilityObsidian>(),
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(async (_app: unknown, content: string) => content),
}));

beforeEach(() => {
	vi.mocked(overwriteTemplaterOnce).mockReset().mockResolvedValue(false);
	vi.mocked(templaterParseTemplate).mockReset();
	vi.mocked(templaterParseTemplate).mockImplementation(async (_app, content) => content);
});

describe("Template write cursor snapshots", () => {
	it("records the marker after rendered values and creates a clean file", async () => {
		const h = templateHarness();
		h.executor.variables.set("date", "2026-09-20");
		h.file("template.md", "## Log\n### {{VALUE:date}}\n- {{cursor}}after{{CURSOR}}");
		await h.engine.create("note.md", "template.md");
		expect(h.contents.get("note.md")).toBe("## Log\n### 2026-09-20\n- after");
		expect(h.engine.getCursorPlacement()).toEqual({
			content: h.contents.get("note.md"), offsets: ["## Log\n### 2026-09-20\n- ".length],
		});
	});

	it("creates an empty note from a marker-only template", async () => {
		const h = templateHarness();
		h.file("template.md", "{{CURSOR}}");
		expect(await h.engine.create("note.md", "template.md")).not.toBeNull();
		expect(h.contents.get("note.md")).toBe("");
		expect(h.engine.getCursorPlacement()).toEqual({ content: "", offsets: [0] });
	});

	it("rebases after structured frontmatter serialization", async () => {
		const h = templateHarness();
		h.executor.variables.set("tags", ["one", "two"]);
		h.file("template.md", "---\ntags: {{VALUE:tags}}\n---\nbefore{{CURSOR}}after");
		await h.engine.create("note.md", "template.md");
		const content = h.contents.get("note.md") ?? "";
		expect(h.frontmatter(h.vault.getFileByPath("note.md")!)).toEqual({ tags: ["one", "two"] });
		expect(h.engine.getCursorPlacement()).toEqual({ content, offsets: [content.indexOf("after")] });
	});

	it("discards placement after Templater rewrites the body", async () => {
		const h = templateHarness();
		h.file("template.md", "before{{CURSOR}}after");
		vi.mocked(overwriteTemplaterOnce).mockImplementation(async (_app, file) => {
			h.contents.set(file.path, "prefix beforeafter");
			return false;
		});
		await h.engine.create("note.md", "template.md");
		expect(h.contents.get("note.md")).toBe("prefix beforeafter");
		expect(h.engine.getCursorPlacement()).toBeNull();
	});

	it("clears a previous placement when marker cleanup fails", async () => {
		const h = templateHarness();
		h.file("template.md", "before{{CURSOR}}after");
		await h.engine.create("first.md", "template.md");
		expect(h.engine.getCursorPlacement()).not.toBeNull();
		h.vault.process.mockRejectedValueOnce(new Error("Write unavailable"));
		expect(await h.engine.create("second.md", "template.md")).toBeNull();
		expect(h.engine.getCursorPlacement()).toBeNull();
	});

	it.each(["before<% result %>{{CURSOR}}after", "<% include %>"])(
		"extracts placement from final rendered content: %s", async template => {
			const h = templateHarness();
			h.file("template.md", template);
			vi.mocked(overwriteTemplaterOnce).mockImplementation(async (_app, file) => {
				h.contents.set(file.path, "before expanded {{CURSOR}}after{{cursor}}");
				return false;
			});
			await h.engine.create("note.md", "template.md");
			expect(h.contents.get("note.md")).toBe("before expanded after");
			expect(h.engine.getCursorPlacement()).toEqual({ content: "before expanded after", offsets: [16] });
		},
	);

	it("cleans body markers when rendering fails", async () => {
		const h = templateHarness();
		h.executor.variables.set("tags", ["one"]);
		h.file("template.md", "---\ntags: {{VALUE:tags}}\n---\nbefore{{CURSOR}}after");
		vi.mocked(overwriteTemplaterOnce).mockRejectedValueOnce(new Error("Render unavailable"));
		expect(await h.engine.create("note.md", "template.md")).toBeNull();
		expect(h.contents.get("note.md")).not.toContain("{{CURSOR}}");
	});

	it("cleans frontmatter markers before YAML processing while retaining body markers for Templater", async () => {
		const h = templateHarness();
		h.executor.variables.set("tags", ["one"]);
		h.file("template.md", "---\ntags: {{VALUE:tags}}\nlabel: {{CURSOR}}\n---\nbefore{{CURSOR}}after");
		vi.mocked(overwriteTemplaterOnce).mockImplementation(async (_app, file) => {
			expect(h.frontmatter(file)).toEqual({ tags: ["one"], label: null });
			expect(h.contents.get(file.path)).toContain("before{{CURSOR}}after");
			return false;
		});
		await h.engine.create("note.md", "template.md");
		expect(h.contents.get("note.md")).not.toContain("{{CURSOR}}");
	});

	it("overwrites with marker placement, then clears it for an unmarked write", async () => {
		const h = templateHarness();
		const file = h.file("note.md", "old");
		h.file("template.md", "before{{CURSOR}}after");
		await h.engine.overwrite(file, "template.md");
		expect(h.engine.getCursorPlacement()).toEqual({ content: "beforeafter", offsets: [6] });
		h.contents.set("template.md", "unmarked");
		await h.engine.overwrite(file, "template.md");
		expect(h.engine.getCursorPlacement()).toBeNull();
	});

	it("strips markers from Canvas output without recording placement", async () => {
		const h = templateHarness();
		h.file("template.canvas", '{"label":"{{CURSOR}}"}');
		await h.engine.create("note.canvas", "template.canvas");
		expect(h.contents.get("note.canvas")).toBe('{"label":""}');
		expect(h.engine.getCursorPlacement()).toBeNull();
	});

	it.each([
		["top", "---\ntags: old\n---\n\nExisting {{CURSOR}}", "---\ntags: old\n---\n\nbeforeafter\nExisting {{CURSOR}}"],
		["top", "---\n---", "---\n---\nbeforeafter\n"],
		["bottom", "Existing {{CURSOR}}", "Existing {{CURSOR}}\nbeforeafter"],
	] as const)("maps %s insertion and leaves existing markers literal", async (mode, note, expected) => {
		const h = templateHarness();
		h.file("template.md", "before{{cursor}}after{{CURSOR}}");
		const file = h.file("note.md", note);
		h.app.vault.process = async (target, transform) => {
			const content = transform(h.contents.get(target.path) ?? "");
			h.contents.set(target.path, content);
			return content;
		};
		const engine = new TemplateInsertEngine(h.app, h.plugin, file, "template.md", mode, h.executor);
		await engine.apply();
		expect(h.contents.get(file.path)).toBe(expected);
		expect(engine.getCursorPlacement()).toEqual({ content: expected, offsets: [expected.indexOf("after")] });
	});

	it("saves a marked editor insertion before merging frontmatter from disk", async () => {
		const h = templateHarness();
		h.file("template.md", "---\nstatus: draft\n---\nBefore{{CURSOR}}after");
		const file = h.file("note.md", "Existing");
		let editorContent = "Existing";
		const cursor = { line: 0, ch: 0 };
		const save = vi.fn(async () => { h.contents.set(file.path, editorContent); });
		const view = {
			file, save,
			editor: {
				getValue: () => editorContent,
				getCursor: () => cursor,
				listSelections: () => [{ anchor: cursor, head: cursor }],
				posToOffset: (position: EditorPosition) => position.ch,
				offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
				setSelections: vi.fn(),
				transaction: ({ changes }: { changes: { text: string }[] }) => {
					editorContent = changes[0].text + editorContent;
				},
			},
		} as unknown as MarkdownView;
		vi.spyOn(h.app.workspace, "getActiveViewOfType").mockReturnValue(view);
		h.app.workspace.getLeavesOfType = () => [Object.assign(new WorkspaceLeaf(), { view })];
		const engine = new TemplateInsertEngine(h.app, h.plugin, file, "template.md", "cursor", h.executor);
		await engine.apply();
		const content = h.contents.get(file.path) ?? "";
		expect(save).toHaveBeenCalledOnce();
		expect(content).toBe("---\nstatus: draft\n---\nBeforeafterExisting");
		expect(engine.getCursorPlacement()).toEqual({ content, offsets: [content.indexOf("after")] });
	});

	it("extracts a fragment marker after Templater expands the inserted text", async () => {
		const h = templateHarness();
		h.file("template.md", "<% result %>{{CURSOR}}after");
		const file = h.file("note.md", "existing");
		h.app.vault.process = async (target, transform) => {
			const content = transform(h.contents.get(target.path) ?? "");
			h.contents.set(target.path, content);
			return content;
		};
		vi.mocked(templaterParseTemplate).mockImplementation(async (_app, content) => content.replace("<% result %>", "expanded"));
		const engine = new TemplateInsertEngine(h.app, h.plugin, file, "template.md", "bottom", h.executor);
		await engine.apply();
		expect(engine.getCursorPlacement()).toEqual({ content: "existing\nexpandedafter", offsets: ["existing\nexpanded".length] });
	});
});
