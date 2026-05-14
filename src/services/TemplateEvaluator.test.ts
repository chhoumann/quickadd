import { describe, expect, it, vi } from "vitest";
import { MacroAbortError } from "../errors/MacroAbortError";
import type { CompleteFormatter } from "../formatters/completeFormatter";
import { TemplateEvaluator } from "./TemplateFileService";

describe("TemplateEvaluator", () => {
	it("sets title, collects property variables, and performs no file writes", async () => {
		const vars = new Map<string, unknown>([["project", { name: "QuickAdd" }]]);
		const formatter = {
			setTitle: vi.fn(),
			withTemplatePropertyCollection: vi.fn(async (callback) => callback()),
			formatFileContent: vi.fn(async (content: string) =>
				content.replace("{{title}}", "Daily"),
			),
			getAndClearTemplatePropertyVars: vi.fn(() => vars),
		} as unknown as CompleteFormatter;

		const result = await new TemplateEvaluator(formatter).evaluateTemplateContent(
			"# {{title}}",
			"Notes/Daily.md",
		);

		expect(formatter.setTitle).toHaveBeenCalledWith("Daily");
		expect(formatter.withTemplatePropertyCollection).toHaveBeenCalledTimes(1);
		expect(formatter.formatFileContent).toHaveBeenCalledWith("# {{title}}");
		expect(formatter.getAndClearTemplatePropertyVars).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			content: "# Daily",
			templatePropertyVars: vars,
		});
	});

	it("propagates MacroAbortError unchanged", async () => {
		const abort = new MacroAbortError("stop");
		const formatter = {
			setTitle: vi.fn(),
			withTemplatePropertyCollection: vi.fn(async () => {
				throw abort;
			}),
			getAndClearTemplatePropertyVars: vi.fn(),
		} as unknown as CompleteFormatter;

		await expect(
			new TemplateEvaluator(formatter).evaluateTemplateContent(
				"content",
				"Notes/Daily.md",
			),
		).rejects.toBe(abort);
		expect(formatter.getAndClearTemplatePropertyVars).not.toHaveBeenCalled();
	});
});
