import { describe, expect, it } from "vitest";
import { transformCase } from "./caseTransform";

describe("transformCase", () => {
	it("supports basic transforms", () => {
		const input = "My New Blog";
		expect(transformCase(input, "kebab")).toBe("my-new-blog");
		expect(transformCase(input, "snake")).toBe("my_new_blog");
		expect(transformCase(input, "camel")).toBe("myNewBlog");
		expect(transformCase(input, "pascal")).toBe("MyNewBlog");
		expect(transformCase(input, "title")).toBe("My New Blog");
		expect(transformCase(input, "lower")).toBe("my new blog");
		expect(transformCase(input, "upper")).toBe("MY NEW BLOG");
	});

	it("handles acronyms with smart camel and preserves them for pascal/title", () => {
		expect(transformCase("API Key", "camel")).toBe("apiKey");
		expect(transformCase("My API Key", "camel")).toBe("myAPIKey");
		expect(transformCase("API Key", "pascal")).toBe("APIKey");
		expect(transformCase("API Key", "title")).toBe("API Key");
	});

	it("preserves mixed-case brand tokens like iOS", () => {
		expect(transformCase("iOS App", "camel")).toBe("iOSApp");
		expect(transformCase("iOS App", "pascal")).toBe("iOSApp");
		expect(transformCase("iOS App", "title")).toBe("iOS App");
	});

	it("supports slug and avoids reserved Windows device names", () => {
		expect(transformCase("My New Blog", "slug")).toBe("my-new-blog");
		expect(transformCase("CON", "slug")).toBe("con-");
		expect(transformCase("A/B*C?", "slug")).toBe("a-b-c");
	});

	it("splits acronym/word boundaries at the last uppercase of the run", () => {
		// Locks the behaviour of the de-`+`'d acronym-boundary split (line 93):
		// the space always lands before the LAST uppercase of an acronym run that
		// precedes a Titlecase word, regardless of run length.
		expect(transformCase("XMLHttp", "title")).toBe("XML Http");
		expect(transformCase("ABCd", "title")).toBe("AB Cd");
		expect(transformCase("XMLHttpRequest", "title")).toBe("XML Http Request");
		expect(transformCase("parseHTMLString", "pascal")).toBe("ParseHTMLString");
	});

	describe("ReDoS resistance", () => {
		// Regression guard for the quadratic backtracking the old acronym-boundary
		// regex `([\p{Lu}]+)([\p{Lu}][\p{Ll}])` exhibited on a long all-caps run:
		// every /g start position re-consumed the whole run then backtracked
		// char-by-char for a trailing lowercase that never comes. The single-char
		// form finishes in sub-millisecond; the old form took multiple seconds at
		// 32K and grew quadratically (~46s at 200K), so a generous budget stays
		// non-flaky while failing hard on any regression.
		const BUDGET_MS = 1500;

		it(
			"tokenizes a long all-uppercase run in linear time",
			() => {
				// Reaches line 93 intact: all-caps fails both leading-lowercase
				// brand guards, and tokenizeWords keeps the unbroken blob as one
				// segment. This is the `{{VALUE|case:...}}` payload shape.
				const input = "A".repeat(200_000);
				const start = performance.now();
				const result = transformCase(input, "pascal");
				const elapsed = performance.now() - start;

				expect(result).toBe("A".repeat(200_000));
				expect(elapsed).toBeLessThan(BUDGET_MS);
			},
			20_000,
		);

		it(
			"handles a long all-caps run with a trailing word in linear time",
			() => {
				const input = "A".repeat(200_000) + "bc";
				const start = performance.now();
				transformCase(input, "kebab");
				const elapsed = performance.now() - start;

				expect(elapsed).toBeLessThan(BUDGET_MS);
			},
			20_000,
		);
	});
});

