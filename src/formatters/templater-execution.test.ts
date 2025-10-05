import { describe, it, expect } from "vitest";

describe("Templater execution control", () => {
	it("should prevent double-execution of templater processing", () => {
		// Mock templater function that tracks calls
		let callCount = 0;
		const mockTemplaterParseTemplate = async (_app: any, content: string) => {
			callCount++;
			return `rendered::${content}`;
		};

		// Simulate the pattern used in CaptureChoiceFormatter
		let templaterProcessed = false;

		const processContent = async (content: string, hasFileContext: boolean) => {
			// First pass: format QuickAdd placeholders (no templater)
			let result = content;

			// Second pass: only run templater if we have file context and haven't processed yet
			if (hasFileContext && !templaterProcessed && content.includes("<%")) {
				result = await mockTemplaterParseTemplate({} as any, content);
				templaterProcessed = true;
			}

			return result;
		};

		// Test the execution flow
		const runTest = async () => {
			// First pass - no file context, should not call templater
			await processContent("Hello <% tp.date.now %>", false);
			expect(callCount).toBe(0);

			// Second pass - with file context, should call templater once
			const result1 = await processContent("Hello <% tp.date.now %>", true);
			expect(callCount).toBe(1);
			expect(result1).toBe("rendered::Hello <% tp.date.now %>");

			// Third pass - templater already processed, should not call again
			const result2 = await processContent("Hello <% tp.date.now %>", true);
			expect(callCount).toBe(1); // Still 1, not 2
			expect(result2).toBe("Hello <% tp.date.now %>"); // Original content, not re-processed

			return true;
		};

		return runTest();
	});
});
