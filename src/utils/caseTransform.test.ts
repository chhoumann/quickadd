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
});

