import { postProcessFrontMatter } from "./helpers/frontmatterPostProcessor";
import { describe, expect, it, vi } from "vitest";
import { templateHarness } from "../../tests/helpers/engines/templateHarness";
import { log } from "../logger/logManager";

vi.mock("../main", () => ({ default: class { } }));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class { } }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

type Properties = Record<string, unknown>;
async function createProperties(values: Properties, enabled = true) {
	const h = templateHarness(enabled);
	for (const [key, value] of Object.entries(values)) h.executor.variables.set(key, value);
	h.file("template.md", `---\n${Object.keys(values).map((key) => `${key}: {{VALUE:${key}}}`).join("\n")}\n---\nBody`);
	const file = await h.engine.create("note.md", "template.md");
	expect(file).not.toBeNull();
	if (!file) throw new Error("Template creation failed");
	expect(h.vault.create).toHaveBeenCalledOnce();
	return { ...h, result: file, properties: h.frontmatter(file) };
}

describe("Template property types through production engines", () => {
	it("should create file with typed template variables and post-process front matter", async () => {
		const values = {
			title: "My New Note", tags: ["work", "project", "urgent"], priority: 5,
			completed: false, metadata: { author: "Test User", version: 1.2, nested: { key: "value" } }
		};
		const h = await createProperties(values);
		expect(h.processFrontMatter).toHaveBeenCalledWith(h.result, expect.any(Function));
		for (const [key, value] of Object.entries(values)) expect(h.properties[key], key).toEqual(value);
	});

	it("should skip post-processing for Canvas files", async () => {
		const h = templateHarness();
		h.file("template.canvas", '{"nodes":[{"text":"{{VALUE:title}}"}]}');
		h.executor.variables.set("title", "Canvas Title");
		const file = await h.engine.create("note.canvas", "template.canvas");
		expect(file).not.toBeNull();
		expect(h.contents.get("note.canvas")).toBe('{"nodes":[{"text":"Canvas Title"}]}');
		expect(h.processFrontMatter).not.toHaveBeenCalled();
	});

	it("should handle overwriteFileWithTemplate with typed variables", async () => {
		const h = templateHarness();
		h.file("template.md", "---\nupdated: {{VALUE:updated}}\nversion: {{VALUE:version}}\nstatus: {{VALUE:status}}\n---\nUpdated content: {{VALUE:content}}");
		for (const [key, value] of Object.entries({ updated: new Date("2025-01-01"), version: 2, status: "active", content: "Updated text" })) {
			h.executor.variables.set(key, value);
		}
		const file = h.file("existing.md", "old");
		expect(await h.engine.overwrite(file, "template.md")).toBe(file);
		expect(h.vault.modify).toHaveBeenCalledOnce();
		expect(h.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
		expect(h.frontmatter(file)).toEqual({ updated: new Date("2025-01-01"), version: 2, status: "active" });
		expect(h.frontmatter(file).content).toBeUndefined();
		expect(h.contents.get(file.path)).toContain("Updated content: Updated text");
	});

	it("should handle processFrontMatter errors gracefully", async () => {
		const h = templateHarness();
		h.file("template.md", "---\ncount: {{VALUE:count}}\n---\nContent");
		h.executor.variables.set("count", 42);
		h.processFrontMatter.mockRejectedValue(new Error("Front matter processing failed"));
		const error = vi.spyOn(log, "logError");
		expect(await h.engine.create("note.md", "template.md")).not.toBeNull();
		expect(h.vault.create).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith(expect.stringContaining("Front matter processing failed"));
		error.mockRestore();
	});

	it("should respect feature flag when disabled", async () => {
		const h = await createProperties({ tags: ["tag1", "tag2"] }, false);
		// Native containers are always collected; the flag gates string heuristics.
		expect(h.processFrontMatter).toHaveBeenCalledOnce();
		expect(h.properties.tags).toEqual(["tag1", "tag2"]);
	});

	it.each([
		["should handle VDATE variables correctly", { due: "@date:2025-12-31", created: "@date:2025-01-01T10:30:00.000Z" }],
		["should handle invalid dates gracefully", { validDate: "@date:2025-01-01", invalidDate: "@date:invalid-date-string" }],
		["should convert @date:ISO strings to Date objects in postProcessFrontMatter", { testDate: "@date:2025-01-15T14:30:00.000Z", regularString: "not a date" }],
		["should handle edge cases in date conversion", { epochDate: "@date:1970-01-01T00:00:00.000Z", invalidDate: "@date:not-a-date", emptyDate: "@date:" }],
	] satisfies [string, Record<string, string>][])("%s", async (_name, values) => {
		const h = templateHarness();
		const file = h.file("dates.md", "---\n---\nContent");
		await postProcessFrontMatter(h.app, file, new Map(Object.entries(values)));
		const properties = h.frontmatter(file);
		for (const [key, value] of Object.entries(values)) {
			const date = new Date(value.slice(6));
			if (value.startsWith("@date:") && !Number.isNaN(date.getTime())) {
				expect(properties[key], key).toBeInstanceOf(Date);
				expect(properties[key], key).toEqual(date);
			} else expect(properties[key], key).toBe(value);
		}
	});

	it.each([
		["should handle arrays correctly", { emptyArray: [], stringArray: ["one", "two", "three"], mixedArray: ["string", 42, true, null] }],
		["should handle objects correctly", { emptyObject: {}, simpleObject: { key: "value", count: 5 }, nestedObject: { level1: { level2: { deep: "value" }, array: [1, 2, 3] } } }],
		["should handle primitive types correctly", { numberInt: 42, numberFloat: 3.14, booleanTrue: true, booleanFalse: false, nullValue: null, stringValue: "Hello World" }],
	] satisfies [string, Properties][])("%s", async (_name, values) => {
		const h = await createProperties(values);
		for (const [key, value] of Object.entries(values)) {
			// An empty selection leaves an empty YAML property, not an explicit list.
			expect(h.properties[key], key).toEqual(Array.isArray(value) && !value.length ? null : value);
		}
	});

	it("should return template variables from getAndClearTemplatePropertyVars", async () => {
		const h = templateHarness();
		h.file("template.md", "---\ntags: {{VALUE:tags}}\npriority: {{VALUE:priority}}\n---\nContent");
		h.executor.variables.set("tags", ["test", "integration"]);
		h.executor.variables.set("priority", 1);
		const single = h.single("template.md");
		await single.run();
		expect(single.getAndClearTemplatePropertyVars()).toEqual(new Map<string, unknown>([["tags", ["test", "integration"]], ["priority", 1]]));
	});

	it("should clear variables after getAndClearTemplatePropertyVars call", async () => {
		const h = templateHarness();
		h.file("template.md", "---\ntest: {{VALUE:test}}\n---\nContent");
		h.executor.variables.set("test", 42);
		const single = h.single("template.md");
		await single.run();
		expect(single.getAndClearTemplatePropertyVars()).toEqual(new Map([["test", 42]]));
		expect(single.getAndClearTemplatePropertyVars().size).toBe(0);
	});
});
