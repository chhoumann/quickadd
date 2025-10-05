import { describe, it, expect, beforeEach } from "vitest";

// Test implementation to access private methods of Formatter
class YamlTestFormatter {
	/**
	 * Finds the YAML front matter range in the input string.
	 * Returns [start, end] indices or null if no front matter is found.
	 * Handles both LF and CRLF line endings correctly.
	 */
	findYamlFrontMatterRange(input: string): [number, number] | null {
		// Use regex to find front matter block, handling CRLF properly
		const frontMatterRegex =
			/^(\s*---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$))/;
		const match = frontMatterRegex.exec(input);

		if (!match) {
			return null;
		}

		const startIndex = 0;
		const endIndex = match[0].length;

		return [startIndex, endIndex];
	}

	/**
	 * Analyzes the context around a variable match to determine if it's in a position
	 * where YAML structure formatting should be applied.
	 */
	getYamlContextForMatch(
		input: string,
		matchStart: number,
		matchEnd: number,
		yamlRange: [number, number] | null
	): {
		isInYaml: boolean;
		isQuoted: boolean;
		lineStart: number;
		lineEnd: number;
		baseIndent: string;
		isKeyValuePosition: boolean;
	} {
		const isInYaml =
			yamlRange !== null &&
			matchStart >= yamlRange[0] &&
			matchStart < yamlRange[1];

		if (!isInYaml) {
			return {
				isInYaml: false,
				isQuoted: false,
				lineStart: 0,
				lineEnd: 0,
				baseIndent: "",
				isKeyValuePosition: false,
			};
		}

		// Find the line containing the match
		const lineStart = input.lastIndexOf("\n", matchStart - 1) + 1;
		const lineEnd = input.indexOf("\n", matchStart);
		const actualLineEnd = lineEnd === -1 ? input.length : lineEnd;

		const before = input.slice(lineStart, matchStart);
		const after = input.slice(matchEnd, actualLineEnd);

		// Extract base indentation
		const baseIndent = (before.match(/^\s*/) || [""])[0];

		// Check if the match is quoted (surrounded by matching quotes on the same line)
		const isQuoted =
			(input[matchStart - 1] === '"' && input[matchEnd] === '"') ||
			(input[matchStart - 1] === "'" && input[matchEnd] === "'");

		// Check if this is a key-value position (format: "key: {{VALUE:var}}" or "key: "{{VALUE:var}}"")
		// Handle both unquoted and quoted placeholders (Obsidian auto-quotes YAML values)
		const beforeTrimmed = before.replace(/["']$/, ""); // Remove trailing quote if present
		const afterTrimmed = after.replace(/^["']/, ""); // Remove leading quote if present
		const isKeyValuePosition =
			/:\s*$/.test(beforeTrimmed) && afterTrimmed.trim().length === 0;

		return {
			isInYaml: true,
			isQuoted,
			lineStart,
			lineEnd: actualLineEnd,
			baseIndent,
			isKeyValuePosition,
		};
	}
}

describe("YAML Front Matter Detection and Context Analysis", () => {
	let formatter: YamlTestFormatter;

	beforeEach(() => {
		formatter = new YamlTestFormatter();
	});

	describe("findYamlFrontMatterRange", () => {
		describe("No front matter cases", () => {
			it("should return null when no front matter exists", () => {
				const input =
					"Just regular content\nwith multiple lines\nno YAML here.";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toBeNull();
			});

			it("should return null for empty input", () => {
				const input = "";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toBeNull();
			});

			it("should return null when YAML markers appear mid-content", () => {
				const input = "Some content\n---\nNot front matter\n---\nMore content";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toBeNull();
			});
		});

		describe("Basic LF front matter", () => {
			it("should detect basic front matter with closing ---", () => {
				const input =
					"---\ntitle: My Note\ntags: [tag1, tag2]\n---\nContent here";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 42]);
			});

			it("should detect closing with ... instead of ---", () => {
				const input =
					"---\ntitle: My Note\ntags: [tag1, tag2]\n...\nContent here";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 42]);
			});

			it("should handle empty front matter block", () => {
				const input = "---\n\n---\nContent here";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 9]);
			});

			it("should handle no trailing newline at EOF", () => {
				const input = "---\ntitle: Note\n---";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 19]);
			});

			it("should handle leading whitespace before opening ---", () => {
				const input = "  ---\ntitle: Note\n---\nContent";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 22]);
			});
		});

		describe("CRLF front matter (Windows line endings)", () => {
			it("should detect CRLF front matter with proper Windows line endings", () => {
				const input =
					"---\r\ntitle: My Note\r\ntags: [tag1, tag2]\r\n---\r\nContent here";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 46]);
			});

			it("should handle CRLF with closing ...", () => {
				const input =
					"---\r\ntitle: My Note\r\ntags: [tag1, tag2]\r\n...\r\nContent here";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 46]);
			});

			it("should handle CRLF empty front matter", () => {
				const input = "---\r\n\r\n---\r\nContent here";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 12]);
			});

			it("should handle CRLF no trailing newline at EOF", () => {
				const input = "---\r\ntitle: Note\r\n---";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 21]);
			});
		});

		describe("Mixed line endings", () => {
			it("should handle mixed LF and CRLF line endings", () => {
				const input = "---\r\ntitle: Mixed\ntags: test\r\n---\nContent";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toEqual([0, 34]);
			});
		});

		describe("Malformed front matter", () => {
			it("should return null for missing closing delimiter", () => {
				const input =
					"---\ntitle: My Note\ntags: [tag1, tag2]\nContent without closing";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toBeNull();
			});

			it("should return null for only opening delimiter", () => {
				const input = "---\ntitle: My Note";
				const result = formatter.findYamlFrontMatterRange(input);
				expect(result).toBeNull();
			});
		});

		describe("Off-by-one boundary tests", () => {
			it("should ensure variables right after closing delimiter are not in YAML", () => {
				const input = "---\ntitle: Note\n---\n{{VALUE:var}}";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				expect(yamlRange).toEqual([0, 20]);

				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;
				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);
				expect(context.isInYaml).toBe(false);
			});

			it("should ensure variables right before closing delimiter are in YAML", () => {
				const input = "---\ntitle: {{VALUE:var}}\n---\nContent";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				expect(yamlRange).toEqual([0, 29]);

				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;
				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);
				expect(context.isInYaml).toBe(true);
			});

			it("should handle variable exactly at YAML boundary", () => {
				const input = "---\ntitle: Note\n{{VALUE:var}}\n---\nContent";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				expect(yamlRange).toEqual([0, 34]);

				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;
				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);
				expect(context.isInYaml).toBe(true);
			});
		});
	});

	describe("getYamlContextForMatch - Context Analysis", () => {
		describe("Variables outside YAML", () => {
			it("should mark variables outside YAML as never eligible", () => {
				const input = "---\ntitle: Note\n---\nContent with {{VALUE:var}}";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(false);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(false);
			});

			it("should handle variables with no YAML at all", () => {
				const input = "Just content with {{VALUE:var}} here";
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					null
				);

				expect(context.isInYaml).toBe(false);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(false);
			});
		});

		describe("Variables in key: value position (unquoted) - should be eligible", () => {
			it("should detect unquoted key-value position", () => {
				const input = "---\ntitle: {{VALUE:var}}\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(true);
			});

			it("should detect key-value position with spaces", () => {
				const input = "---\ntitle:   {{VALUE:var}}\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(true);
			});

			it("should detect indented key-value position", () => {
				const input = "---\nmetadata:\n  title: {{VALUE:var}}\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(true);
				expect(context.baseIndent).toBe("  ");
			});
		});

		describe("Variables in quoted contexts - should not be eligible", () => {
			it("should detect double-quoted variable", () => {
				const input = '---\ntitle: "{{VALUE:var}}"\n---';
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(true);
				expect(context.isKeyValuePosition).toBe(true); // Still in key-value position but quoted
			});

			it("should detect single-quoted variable", () => {
				const input = "---\ntitle: '{{VALUE:var}}'\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(true);
				expect(context.isKeyValuePosition).toBe(true);
			});

			it("should handle quoted values with auto-quoting behavior", () => {
				const input = '---\ntitle: "{{VALUE:var}}"\n---';
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isKeyValuePosition).toBe(true); // Should still detect key-value even with quotes
			});
		});

		describe("Variables in complex inline contexts - should not be eligible", () => {
			it("should detect variable in array context", () => {
				const input = "---\ntags: [tag1, {{VALUE:var}}, tag3]\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(false); // Not a simple key-value position
			});

			it("should detect variable in multi-line context", () => {
				const input =
					"---\ndescription: |\n  Multi-line content\n  with {{VALUE:var}} inside\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(false);
			});

			it("should detect variable with text before colon on same line", () => {
				const input = "---\ntitle: Some text {{VALUE:var}}\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(false); // Has text after colon, not pure key-value
			});
		});

		describe("Cross-platform compatibility", () => {
			it("should work with CRLF line endings for context analysis", () => {
				const input = "---\r\ntitle: {{VALUE:var}}\r\n---\r\nContent";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(true);
			});

			it("should work with mixed line endings for context analysis", () => {
				const input = "---\r\ntitle: {{VALUE:var}}\n---\r\nContent";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isQuoted).toBe(false);
				expect(context.isKeyValuePosition).toBe(true);
			});

			it("should handle line detection with mixed endings", () => {
				const input =
					"---\nkey1: value1\r\ntitle: {{VALUE:var}}\nkey2: value2\r\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.lineStart).toBeGreaterThan(0);
				expect(context.lineEnd).toBeGreaterThan(context.lineStart);
			});
		});

		describe("Edge cases and boundary conditions", () => {
			it("should handle variable at end of file", () => {
				const input = "---\ntitle: {{VALUE:var}}";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				expect(yamlRange).toBeNull(); // No closing delimiter, so no valid YAML

				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;
				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					null
				);

				expect(context.isInYaml).toBe(false);
			});

			it("should handle variable at beginning of YAML line", () => {
				const input = "---\n{{VALUE:var}}: value\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isKeyValuePosition).toBe(false); // Variable is a key, not a value
			});

			it("should handle empty line context", () => {
				const input = "---\ntitle: value\n\n{{VALUE:var}}\n---";
				const yamlRange = formatter.findYamlFrontMatterRange(input);
				const variableStart = input.indexOf("{{VALUE:var}}");
				const variableEnd = variableStart + "{{VALUE:var}}".length;

				const context = formatter.getYamlContextForMatch(
					input,
					variableStart,
					variableEnd,
					yamlRange
				);

				expect(context.isInYaml).toBe(true);
				expect(context.isKeyValuePosition).toBe(false);
				expect(context.baseIndent).toBe("");
			});
		});
	});
});
