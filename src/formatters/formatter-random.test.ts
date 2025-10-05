import { describe, it, expect, beforeEach } from "vitest";
import { RANDOM_REGEX } from "../constants";

// Test implementation that includes the replaceRandomInString method
class TestFormatter {
	protected replacer(str: string, reg: RegExp, replaceValue: string) {
		return str.replace(reg, () => replaceValue);
	}

	protected replaceRandomInString(input: string): string {
		let output = input;

		while (RANDOM_REGEX.test(output)) {
			const match = RANDOM_REGEX.exec(output);
			if (!match || !match[1]) continue;

			const length = parseInt(match[1], 10);
			if (length <= 0 || length > 100) {
				throw new Error(
					`Random string length must be between 1 and 100. Got: ${length}`
				);
			}

			const chars =
				"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
			let randomString = "";

			for (let i = 0; i < length; i++) {
				randomString += chars.charAt(Math.floor(Math.random() * chars.length));
			}

			output = output.replace(match[0], randomString);
		}

		return output;
	}

	// Expose for testing
	public testReplaceRandomInString(input: string): string {
		return this.replaceRandomInString(input);
	}
}

describe("Random Format Placeholder", () => {
	let formatter: TestFormatter;

	beforeEach(() => {
		formatter = new TestFormatter();
	});

	describe("RANDOM_REGEX", () => {
		it("should match valid random placeholders", () => {
			expect(RANDOM_REGEX.test("{{RANDOM:6}}")).toBe(true);
			expect(RANDOM_REGEX.test("{{random:6}}")).toBe(true);
			expect(RANDOM_REGEX.test("{{Random:10}}")).toBe(true);
			expect(RANDOM_REGEX.test("{{RANDOM:1}}")).toBe(true);
			expect(RANDOM_REGEX.test("{{RANDOM:100}}")).toBe(true);
		});

		it("should not match invalid random placeholders", () => {
			expect(RANDOM_REGEX.test("{{RANDOM}}")).toBe(false);
			expect(RANDOM_REGEX.test("{{RANDOM:}}")).toBe(false);
			expect(RANDOM_REGEX.test("{{RANDOM:abc}}")).toBe(false);
			expect(RANDOM_REGEX.test("{{RANDOM:-5}}")).toBe(false);
			// Note: {{RANDOM:0}} is matched by the regex but handled as invalid in the method
		});

		it("should extract the length parameter correctly", () => {
			const match = RANDOM_REGEX.exec("{{RANDOM:6}}");
			expect(match?.[1]).toBe("6");

			const match2 = RANDOM_REGEX.exec("{{random:15}}");
			expect(match2?.[1]).toBe("15");
		});
	});

	describe("replaceRandomInString", () => {
		it("should replace single random placeholder", () => {
			const input = "Block reference: ^{{RANDOM:6}}";
			const result = formatter.testReplaceRandomInString(input);

			// Check that the placeholder was replaced with 6 alphanumeric characters
			expect(result).toMatch(/^Block reference: \^[A-Za-z0-9]{6}$/);
			expect(result).not.toContain("{{RANDOM:6}}");
		});

		it("should replace multiple random placeholders with different values", () => {
			const input = "First: {{RANDOM:4}}, Second: {{RANDOM:4}}";
			const result = formatter.testReplaceRandomInString(input);

			// Extract the generated values after "First: " and "Second: "
			const firstMatch = result.match(/First: ([A-Za-z0-9]{4})/);
			const secondMatch = result.match(/Second: ([A-Za-z0-9]{4})/);

			expect(firstMatch).toBeTruthy();
			expect(secondMatch).toBeTruthy();

			// The two generated values should be different (with very high probability)
			expect(firstMatch?.[1]).not.toBe(secondMatch?.[1]);
		});

		it("should handle different lengths", () => {
			const input =
				"Short: {{RANDOM:2}}, Medium: {{RANDOM:10}}, Long: {{RANDOM:20}}";
			const result = formatter.testReplaceRandomInString(input);

			const shortMatch = result.match(/Short: ([A-Za-z0-9]+)/);
			const mediumMatch = result.match(/Medium: ([A-Za-z0-9]+)/);
			const longMatch = result.match(/Long: ([A-Za-z0-9]+)/);

			expect(shortMatch?.[1]).toHaveLength(2);
			expect(mediumMatch?.[1]).toHaveLength(10);
			expect(longMatch?.[1]).toHaveLength(20);
		});

		it("should handle mixed case placeholders", () => {
			const input1 = "{{random:5}}";
			const result1 = formatter.testReplaceRandomInString(input1);
			expect(result1).toMatch(/^[A-Za-z0-9]{5}$/);

			const input2 = "{{Random:5}}";
			const result2 = formatter.testReplaceRandomInString(input2);
			expect(result2).toMatch(/^[A-Za-z0-9]{5}$/);
		});

		it("should handle invalid length gracefully", () => {
			const input1 = "{{RANDOM:0}}";
			expect(() => formatter.testReplaceRandomInString(input1)).toThrow(
				"Random string length must be between 1 and 100"
			);

			const input2 = "{{RANDOM:101}}";
			expect(() => formatter.testReplaceRandomInString(input2)).toThrow(
				"Random string length must be between 1 and 100"
			);

			// Note: {{RANDOM:-5}} won't match the regex pattern, so it won't be processed
			const input3 = "{{RANDOM:-5}}";
			const result3 = formatter.testReplaceRandomInString(input3);
			expect(result3).toBe("{{RANDOM:-5}}"); // Should remain unchanged
		});

		it("should work in templates with block references", () => {
			const input =
				"## Section\nContent here ^{{RANDOM:6}}\n\n## Another Section\nMore content ^{{RANDOM:6}}";
			const result = formatter.testReplaceRandomInString(input);

			// Should have two different block references
			const blockRefMatches = result.match(/\^[A-Za-z0-9]{6}/g);
			expect(blockRefMatches).toHaveLength(2);
			expect(blockRefMatches?.[0]).not.toBe(blockRefMatches?.[1]);
		});
	});

	describe("random string generation properties", () => {
		it("should only contain alphanumeric characters", () => {
			const input = "{{RANDOM:50}}";
			const result = formatter.testReplaceRandomInString(input);

			expect(result).toMatch(/^[A-Za-z0-9]{50}$/);
		});

		it("should generate different values on each call", () => {
			const input = "{{RANDOM:10}}";
			const results = new Set();

			// Generate 10 random strings
			for (let i = 0; i < 10; i++) {
				const result = formatter.testReplaceRandomInString(input);
				results.add(result);
			}

			// All 10 should be unique (with very high probability)
			expect(results.size).toBe(10);
		});
	});
});
