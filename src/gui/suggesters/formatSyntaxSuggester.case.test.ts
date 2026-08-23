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

	it.each(["DATE", "TIME", "VDATE"])(
		"suggests case styles while typing inside %s",
		async (token) => {
			const prefix =
				token === "VDATE"
					? "{{VDATE:date,dddd|case:l"
					: `{{${token}:dddd|case:l`;
			expect(await suggestInserts(prefix)).toEqual(["lower"]);
		},
	);

	it.each([
		"{{DATE:[|case:l",
		"{{TIME:[literal |case:l",
		"{{VDATE:date,[literal |case:l",
	])("does not suggest case styles inside an open Moment literal: %s", async (prefix) => {
		expect(await suggestInserts(prefix)).not.toContain("lower");
	});

	it("resumes case suggestions after a Moment literal is closed", async () => {
		expect(await suggestInserts("{{DATE:[literal]|case:l")).toEqual(["lower"]);
	});

	it("offers complete date and time case examples", async () => {
		expect(await suggestInserts("{{dat")).toContain(
			"{{DATE:dddd, MMMM Do, YYYY|case:lower}}",
		);
		expect(await suggestInserts("{{vdat")).toContain(
			"{{VDATE:date,dddd, MMMM Do, YYYY|case:lower}}",
		);
		expect(await suggestInserts("{{tim")).toContain(
			"{{TIME:A|case:lower}}",
		);
	});
});
