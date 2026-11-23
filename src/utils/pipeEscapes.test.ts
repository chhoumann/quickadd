import { describe, expect, it } from "vitest";
import { unescapePipesInTokens } from "./pipeEscapes";

const FENCE = "```";

describe("unescapePipesInTokens", () => {
	it("decodes the escaped pipe inside a token in a table cell", () => {
		expect(
			unescapePipesInTokens("| {{FILE:Persons\\|label:Prompt Three}} |"),
		).toBe("| {{FILE:Persons|label:Prompt Three}} |");
	});

	it("keeps escaped pipes outside tokens", () => {
		expect(
			unescapePipesInTokens("a \\| b {{VALUE:x\\|default:y}} c \\| d"),
		).toBe("a \\| b {{VALUE:x|default:y}} c \\| d");
	});

	it("leaves inline script code byte-identical", () => {
		const input = `${FENCE}js quickadd\nreturn "{{VALUE:a\\|b}}".match(/a\\|b/);\n${FENCE} {{VALUE:x\\|y}}`;
		expect(unescapePipesInTokens(input)).toBe(
			`${FENCE}js quickadd\nreturn "{{VALUE:a\\|b}}".match(/a\\|b/);\n${FENCE} {{VALUE:x|y}}`,
		);
	});

	it("does not pair an opener with a closer inside a later fence", () => {
		const input = `{{VALUE:a\\|b ${FENCE}js quickadd\nreturn "}}";\n${FENCE}`;
		expect(unescapePipesInTokens(input)).toBe(input);
	});

	it("leaves a span that crosses a line break alone", () => {
		const input = "{{FILE:a\n\\|b}}";
		expect(unescapePipesInTokens(input)).toBe(input);
	});

	// Same budget and size as vdate-redos.test.ts.
	it(
		"scans an unterminated opener flood in linear time",
		() => {
			const input = "{{".repeat(200_000) + "\\|";
			const start = performance.now();
			expect(unescapePipesInTokens(input)).toBe(input);
			expect(performance.now() - start).toBeLessThan(1000);
		},
		20_000,
	);
});
