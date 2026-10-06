import { describe, expect, it } from "vitest";
import { parseInline } from "./inlineMarkdown";

describe("parseInline", () => {
	it("reads code, bold, and docs links, with code inside a link", () => {
		expect(parseInline("Run **Log** on [`{{DAILY}}`](/docs/FormatSyntax/#daily) now.")).toEqual([
			{ kind: "text", text: "Run " },
			{ kind: "bold", children: [{ kind: "text", text: "Log" }] },
			{ kind: "text", text: " on " },
			{
				kind: "link",
				href: "https://quickadd.obsidian.guide/docs/FormatSyntax/#daily",
				children: [{ kind: "code", text: "{{DAILY}}" }],
			},
			{ kind: "text", text: " now." },
		]);
	});

	it("keeps an https link and leaves any other target as text", () => {
		expect(parseInline("[token](https://readwise.io/access_token) [x](javascript:alert(1))")).toEqual([
			{ kind: "link", href: "https://readwise.io/access_token", children: [{ kind: "text", text: "token" }] },
			{ kind: "text", text: " " },
			{ kind: "text", text: "[x](javascript:alert(1)" },
			{ kind: "text", text: ")" },
		]);
	});
});
