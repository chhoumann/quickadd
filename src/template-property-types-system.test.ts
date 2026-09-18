import { describe, expect, it, vi } from "vitest";
import { createPropertyPipeline, propertyTemplate } from "../tests/helpers/template-properties/pipeline";
import { log } from "./logger/logManager";

vi.mock("./logger/logManager", () => ({
	log: { logError: vi.fn(), logWarning: vi.fn(), logMessage: vi.fn() },
}));

describe("Template property collection and post-processing", () => {
	it.each([
		{ name: "academic authors", value: ["Dr. Sarah Johnson", "Prof. Michael Chen"] },
		{ name: "project metadata", value: { journal: "Nature", volume: 13, pages: "123-135" } },
		{ name: "nested milestones", value: { phase: { deadline: "2024-01-30", percentage: 65 } } },
		{ name: "object arrays", value: [{ name: "primary", config: { poolSize: 20 } }] },
		{ name: "numeric scalar", value: 2023 },
		{ name: "boolean scalar", value: false },
		{ name: "large array", value: Array.from({ length: 1000 }, (_, index) => `item${index}`) },
	])("preserves $name through the production pipeline", async ({ value }) => {
		const pipeline = createPropertyPipeline({ untouched: "keep" });
		await pipeline.process(pipeline.collect(propertyTemplate(["value"]), { value }));
		expect(pipeline.frontmatter).toEqual({ untouched: "keep", value });
		expect(pipeline.processFrontMatter).toHaveBeenCalledOnce();
		expect(pipeline.collector.drain().size).toBe(0);
	});

	it.each(["\n", "\r\n"])("collects only whole frontmatter values with %j line endings", async (lineEnding) => {
		const input = ["---", "authors: {{VALUE:authors}}", "inline: before {{VALUE:inline}} after", "---", "{{VALUE:body}}"].join(lineEnding);
		const pipeline = createPropertyPipeline();
		const variables = pipeline.collect(input, { authors: ["A", "B"], inline: ["excluded"], body: ["excluded"] });
		expect([...variables.keys()]).toEqual(["authors"]);
		await pipeline.process(variables);
		expect(pipeline.frontmatter).toEqual({ authors: ["A", "B"] });
	});

	it.each([true, false])("retains containers with heuristic enabled=%s", async (enabled) => {
		const pipeline = createPropertyPipeline();
		const variables = pipeline.collect(propertyTemplate(["authors", "count"]), { authors: ["A"], count: 42 }, enabled);
		expect(variables.get("authors")).toEqual(["A"]);
		expect(variables.has("count")).toBe(enabled);
		await pipeline.process(variables);
		expect(pipeline.frontmatter.authors).toEqual(["A"]);
	});

	it("does not retain absent or empty values between templates", () => {
		const pipeline = createPropertyPipeline();
		expect(pipeline.collect(propertyTemplate(["authors"]), { authors: ["A"] }).size).toBe(1);
		expect(pipeline.collect(propertyTemplate(["authors", "missing"]), { authors: [] }).size).toBe(0);
	});

	it("preserves fields supplied by Templater while updating collected properties", async () => {
		const pipeline = createPropertyPipeline({ templater: "<% tp.file.title %>", added: "existing" });
		await pipeline.process(pipeline.collect(propertyTemplate(["authors"]), { authors: ["A"] }));
		expect(pipeline.frontmatter).toEqual({ templater: "<% tp.file.title %>", added: "existing", authors: ["A"] });
	});

	it("rejects circular data without calling the native YAML writer", async () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const pipeline = createPropertyPipeline({ original: true });
		await pipeline.process(pipeline.collect(propertyTemplate(["data"]), { data: circular }));
		expect(pipeline.processFrontMatter).not.toHaveBeenCalled();
		expect(pipeline.frontmatter).toEqual({ original: true });
		expect(log.logError).toHaveBeenCalledWith(expect.stringContaining("validation errors"));
	});

	it("reports native YAML errors without rejecting the completed file operation", async () => {
		const pipeline = createPropertyPipeline();
		pipeline.processFrontMatter.mockRejectedValueOnce(new Error("Invalid YAML"));
		await expect(pipeline.process(new Map([["authors", ["A"]]]))).resolves.toBeUndefined();
		expect(log.logError).toHaveBeenCalledWith(expect.stringContaining("Invalid YAML"));
	});
});
