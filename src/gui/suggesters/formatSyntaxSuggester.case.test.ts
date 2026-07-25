import { describe, expect, it } from "vitest";
import {
	suggestInserts,
	suggestRows,
} from "../../../tests/suggesters/formatSuggesterHarness";

describe("FormatSyntaxSuggester case style suggestions", () => {
	it("suggests kebab when typing a |case: prefix", async () => {
		const s = await suggestInserts("{{VALUE:title|case:k");
		expect(s).toEqual(["kebab"]);
	});

	it("suggests all styles (including slug) when case fragment is empty", async () => {
		const s = await suggestInserts("{{VALUE:title|case:");
		expect(s).toEqual([
			"kebab",
			"snake",
			"camel",
			"pascal",
			"title",
			"lower",
			"upper",
			"slug",
		]);
	});

	it("shows what each style does to a title, and renders as a bare fragment", async () => {
		const rows = await suggestRows("{{VALUE:title|case:");
		expect(rows.find((row) => row.insert === "kebab")?.description).toBe(
			"my-note-title",
		);
		expect(rows.every((row) => row.isFragment)).toBe(true);
		// A fragment replaces the typed letters in place, so the caret stays put.
		expect(rows.every((row) => row.caretOffset === 0)).toBe(true);
	});

	it("includes a trim example in VALUE variable suggestions", async () => {
		const s = await suggestInserts("{{VALUE");
		expect(s).toContain("{{VALUE:title|trim}}");
	});
});
