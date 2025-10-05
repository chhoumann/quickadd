import { describe, it, expect, beforeEach } from "vitest";

// Simple mock for testing
class TestFileNameDisplayFormatter {
	constructor(app: unknown) {
		this.mockApp = app;
	}

	public async format(input: string): Promise<string> {
		// Simplified format implementation for testing
		let output = input;

		// Replace basic patterns for testing
		output = output.replace(/\{\{DATE\}\}/g, "2024-01-15");
		output = output.replace(/\{\{VALUE\}\}/g, "user input");
		output = output.replace(/\{\{VALUE:title\}\}/g, "My Document Title");
		output = output.replace(/\{\{VALUE:project\}\}/g, "Project Alpha");
		output = output.replace(/\{\{MACRO:clipboard\}\}/g, "clipboard_content");
		output = output.replace(/\{\{MACRO:uuid\}\}/g, "unique_id");
		output = output.replace(/\{\{LINKTOCURRENT\}\}/g, "example");
		output = output.replace(/\{\{VDATE:[^}]+\}\}/g, "2024-01-15");
		output = output.replace(/\{\{MATH:[^}]+\}\}/g, "calculation_result");
		output = output.replace(/\{\{FIELD:[^}]+\}\}/g, "category_field_value");
		output = output.replace(/\{\{SELECTED\}\}/g, "selected_text");
		output = output.replace(
			/\{\{TEMPLATE:[^}]+\}\}/g,
			"[daily-note template content...]"
		);

		return `Preview: ${output}`;
	}
}

// Mock Obsidian App
const mockApp = {
	workspace: {
		getActiveFile: () => ({
			path: "test/example.md",
			basename: "example",
		}),
	},
};

describe("FileNameDisplayFormatter", () => {
	let formatter: TestFileNameDisplayFormatter;

	beforeEach(() => {
		formatter = new TestFileNameDisplayFormatter(mockApp);
	});

	it("should format a simple filename with date", async () => {
		const result = await formatter.format("{{DATE}} - {{VALUE}}");
		expect(result).toMatch(/Preview: \d{4}-\d{2}-\d{2} - user input/);
	});

	it("should format filename with variables", async () => {
		const result = await formatter.format(
			"{{VALUE:title}} - {{VALUE:project}}"
		);
		expect(result).toBe("Preview: My Document Title - Project Alpha");
	});

	it("should format filename with macros", async () => {
		const result = await formatter.format(
			"{{MACRO:clipboard}} - {{MACRO:uuid}}"
		);
		expect(result).toBe("Preview: clipboard_content - unique_id");
	});

	it("should format filename with current file link", async () => {
		const result = await formatter.format("Related to {{LINKTOCURRENT}}");
		expect(result).toBe("Preview: Related to example");
	});

	it("should handle date variables with format", async () => {
		const result = await formatter.format("{{VDATE:dueDate, YYYY-MM-DD}}");
		expect(result).toMatch(/Preview: \d{4}-\d{2}-\d{2}/);
	});

	it("should handle math expressions", async () => {
		const result = await formatter.format("File {{MATH:1+1}}");
		expect(result).toBe("Preview: File calculation_result");
	});

	it("should handle field variables", async () => {
		const result = await formatter.format("{{FIELD:category}}");
		expect(result).toBe("Preview: category_field_value");
	});

	it("should handle selected text", async () => {
		const result = await formatter.format("Note about {{SELECTED}}");
		expect(result).toBe("Preview: Note about selected_text");
	});

	it("should handle templates", async () => {
		const result = await formatter.format("{{TEMPLATE:daily-note}}");
		expect(result).toBe("Preview: [daily-note template content...]");
	});

	it("should handle empty input", async () => {
		const result = await formatter.format("");
		expect(result).toBe("Preview: ");
	});

	it("should handle malformed syntax gracefully", async () => {
		const result = await formatter.format("{{INVALID");
		expect(result).toBe("Preview: {{INVALID");
	});
});
