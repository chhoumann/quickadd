import { describe, expect, it, vi } from "vitest";
import { templateHarness } from "../../tests/helpers/engines/templateHarness";

vi.mock("../main", () => ({ default: class {} }));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

describe("TemplateEngine title handling", () => {
	it.each([
		["should extract title from simple filename", "MyNote.md", "MyNote"],
		["should extract title from path with folders", "folder/subfolder/MyNote.md", "MyNote"],
		["should handle filename without extension", "MyNote", "MyNote"],
		["should handle root level files", "/MyNote.md", "MyNote"],
		["should handle empty path gracefully", "", ""],
		["should handle files with multiple dots", "my.complex.note.md", "my.complex.note"],
		["should extract title from .canvas filename", "folder/CanvasDoc.canvas", "CanvasDoc"],
		["should extract title from .base filename", "folder/Kanban.base", "Kanban"],
	])("%s", async (_name, path, title) => {
		const h = templateHarness();
		h.file("template.md", "# {{title}}\n\nContent here");
		const setTitle = vi.spyOn(h.engine.bodyFormatter, "setTitle");
		await h.engine.create(path, "template.md");
		expect(setTitle).toHaveBeenCalledWith(title);
		if (path && !path.startsWith("/")) {
			expect(h.contents.get(path)).toBe(`# ${title}\n\nContent here`);
		}
	});

	it("should format content with title replacement", async () => {
		const h = templateHarness();
		h.file("template.md", "# {{title}}\n\nContent here");
		const setTitle = vi.spyOn(h.engine.bodyFormatter, "setTitle");
		const format = vi.spyOn(h.engine.bodyFormatter, "formatFileContent");
		expect(await h.engine.create("TestDocument.md", "template.md")).not.toBeNull();
		expect(setTitle).toHaveBeenCalledWith("TestDocument");
		expect(format).toHaveBeenCalledWith("# {{title}}\n\nContent here");
		expect(h.contents.get("TestDocument.md")).toBe("# TestDocument\n\nContent here");
	});

	it("refuses circular title references in filename formatting", async () => {
		const h = templateHarness();
		h.formatter.setTitle("MyTitle");
		await expect(h.formatter.formatFileName("{{title}}-note.md"))
			.rejects.toThrow("{{title}} cannot be used in file names");
	});
});
