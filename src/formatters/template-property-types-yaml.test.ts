import { describe, expect, it } from "vitest";
import { findYamlFrontMatterRange, getYamlContextForMatch } from "../utils/yamlContext";

describe("YAML front matter ranges", () => {
	it.each([
		['should return null when no front matter exists', 'Just regular content\nwith multiple lines\nno YAML here.', null],
		['should return null for empty input', '', null],
		['should return null when YAML markers appear mid-content', 'Some content\n---\nNot front matter\n---\nMore content', null],
		['should detect basic front matter with closing ---', '---\ntitle: My Note\ntags: [tag1, tag2]\n---\nContent here', [0, 42]],
		['should detect closing with ... instead of ---', '---\ntitle: My Note\ntags: [tag1, tag2]\n...\nContent here', [0, 42]],
		['should handle empty front matter block', '---\n\n---\nContent here', [0, 9]],
		['should handle no trailing newline at EOF', '---\ntitle: Note\n---', [0, 19]],
		['should handle leading whitespace before opening ---', '  ---\ntitle: Note\n---\nContent', [0, 22]],
		['should detect CRLF front matter with proper Windows line endings', '---\r\ntitle: My Note\r\ntags: [tag1, tag2]\r\n---\r\nContent here', [0, 46]],
		['should handle CRLF with closing ...', '---\r\ntitle: My Note\r\ntags: [tag1, tag2]\r\n...\r\nContent here', [0, 46]],
		['should handle CRLF empty front matter', '---\r\n\r\n---\r\nContent here', [0, 12]],
		['should handle CRLF no trailing newline at EOF', '---\r\ntitle: Note\r\n---', [0, 21]],
		['should handle mixed LF and CRLF line endings', '---\r\ntitle: Mixed\ntags: test\r\n---\nContent', [0, 34]],
		['should return null for missing closing delimiter', '---\ntitle: My Note\ntags: [tag1, tag2]\nContent without closing', null],
		['should return null for only opening delimiter', '---\ntitle: My Note', null]
	])("%s", (_name, input, expected) => {
		expect(findYamlFrontMatterRange(input)).toEqual(expected);
	});
});

describe("YAML token contexts", () => {
	it.each([
		['should ensure variables right after closing delimiter are not in YAML', '---\ntitle: Note\n---\n{{VALUE:var}}', { isInYaml: false }, [0, 20], false],
		['should ensure variables right before closing delimiter are in YAML', '---\ntitle: {{VALUE:var}}\n---\nContent', { isInYaml: true }, [0, 29], false],
		['should handle variable exactly at YAML boundary', '---\ntitle: Note\n{{VALUE:var}}\n---\nContent', { isInYaml: true }, [0, 34], false],
		['should mark variables outside YAML as never eligible', '---\ntitle: Note\n---\nContent with {{VALUE:var}}', { isInYaml: false, isQuoted: false, isKeyValuePosition: false }, undefined, false],
		['should handle variables with no YAML at all', 'Just content with {{VALUE:var}} here', { isInYaml: false, isQuoted: false, isKeyValuePosition: false }, undefined, false],
		['should detect unquoted key-value position', '---\ntitle: {{VALUE:var}}\n---', { isInYaml: true, isQuoted: false, isKeyValuePosition: true }, undefined, false],
		['should detect key-value position with spaces', '---\ntitle:   {{VALUE:var}}\n---', { isInYaml: true, isQuoted: false, isKeyValuePosition: true }, undefined, false],
		['should detect indented key-value position', '---\nmetadata:\n  title: {{VALUE:var}}\n---', { isInYaml: true, isQuoted: false, isKeyValuePosition: true, baseIndent: '  ' }, undefined, false],
		['should detect double-quoted variable', '---\ntitle: "{{VALUE:var}}"\n---', { isInYaml: true, isQuoted: true, isKeyValuePosition: true }, undefined, false],
		['should detect single-quoted variable', "---\ntitle: '{{VALUE:var}}'\n---", { isInYaml: true, isQuoted: true, isKeyValuePosition: true }, undefined, false],
		['should handle quoted values with auto-quoting behavior', '---\ntitle: "{{VALUE:var}}"\n---', { isKeyValuePosition: true }, undefined, false],
		['should detect variable in array context', '---\ntags: [tag1, {{VALUE:var}}, tag3]\n---', { isInYaml: true, isQuoted: false, isKeyValuePosition: false }, undefined, false],
		['should detect variable in multi-line context', '---\ndescription: |\n  Multi-line content\n  with {{VALUE:var}} inside\n---', { isInYaml: true, isQuoted: false, isKeyValuePosition: false }, undefined, false],
		['should detect variable with text before colon on same line', '---\ntitle: Some text {{VALUE:var}}\n---', { isInYaml: true, isQuoted: false, isKeyValuePosition: false }, undefined, false],
		['should work with CRLF line endings for context analysis', '---\r\ntitle: {{VALUE:var}}\r\n---\r\nContent', { isInYaml: true, isQuoted: false, isKeyValuePosition: true }, undefined, false],
		['should work with mixed line endings for context analysis', '---\r\ntitle: {{VALUE:var}}\n---\r\nContent', { isInYaml: true, isQuoted: false, isKeyValuePosition: true }, undefined, false],
		['should handle line detection with mixed endings', '---\nkey1: value1\r\ntitle: {{VALUE:var}}\nkey2: value2\r\n---', { isInYaml: true }, undefined, true],
		['should handle variable at end of file', '---\ntitle: {{VALUE:var}}', { isInYaml: false }, undefined, false],
		['should handle variable at beginning of YAML line', '---\n{{VALUE:var}}: value\n---', { isInYaml: true, isKeyValuePosition: false }, undefined, false],
		['should handle empty line context', '---\ntitle: value\n\n{{VALUE:var}}\n---', { isInYaml: true, isKeyValuePosition: false, baseIndent: '' }, undefined, false]
	])("%s", (_name, input, expected, expectedRange, checkLines) => {
		const range = findYamlFrontMatterRange(input);
		if (expectedRange) expect(range).toEqual(expectedRange);
		const start = input.indexOf("{{VALUE:var}}");
		const context = getYamlContextForMatch(input, start, start + "{{VALUE:var}}".length, range);
		expect(context).toMatchObject(expected);
		if (checkLines) {
			expect(context.lineStart).toBeGreaterThan(0);
			expect(context.lineEnd).toBeGreaterThan(context.lineStart);
		}
	});
});
