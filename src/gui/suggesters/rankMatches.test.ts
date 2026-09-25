import { describe, expect, it } from "vitest";
import { rankMatches } from "./rankMatches";

// The obsidian stub's prepareFuzzySearch grades exact > prefix > word start >
// substring > gapped; these tests cover the wiring around it (order, limit,
// case, trimming), while the real Obsidian ranking is asserted end-to-end.
const items = (ranked: ReturnType<typeof rankMatches<string>>) =>
	ranked.map(({ item }) => item);

describe("rankMatches", () => {
	const options = [
		"Aqua Carpatica",
		"Bank Stołeczny",
		"C",
		"Creative Labs",
		"Kawa Górska",
	];

	it("ranks exact, prefix, word-start and substring matches in that order", () => {
		expect(items(rankMatches("c", options, (o) => o, { limit: 200 }))).toEqual([
			"C",
			"Creative Labs",
			"Aqua Carpatica",
			"Bank Stołeczny",
		]);
	});

	it("puts gapped matches after substring matches", () => {
		expect(
			items(rankMatches("kg", ["Kawa Górska", "kg"], (o) => o, { limit: 200 })),
		).toEqual(["kg", "Kawa Górska"]);
	});

	it("keeps list order between equal scores", () => {
		expect(
			items(rankMatches("b", ["beta", "bravo", "alpha", "bar"], (o) => o, { limit: 200 })),
		).toEqual(["beta", "bravo", "bar"]);
	});

	it("returns the list in its own order for an empty or blank query", () => {
		expect(items(rankMatches("", options, (o) => o, { limit: 3 }))).toEqual(options.slice(0, 3));
		expect(items(rankMatches("   ", options, (o) => o, { limit: 200 }))).toEqual(options);
	});

	it("trims the query before matching", () => {
		expect(items(rankMatches(" cre ", options, (o) => o, { limit: 200 }))).toEqual([
			"Creative Labs",
		]);
	});

	it("applies the limit after ranking", () => {
		expect(items(rankMatches("c", options, (o) => o, { limit: 2 }))).toEqual([
			"C",
			"Creative Labs",
		]);
	});

	it("returns the match ranges of each item", () => {
		expect(rankMatches("carp", options, (o) => o, { limit: 200 })).toEqual([
			{ item: "Aqua Carpatica", matches: [[5, 9]] },
		]);
	});

	it("requires the typed text in the option's own case when caseSensitive", () => {
		const opts = { limit: 200, caseSensitive: true };
		expect(items(rankMatches("Ba", ["Bank", "bank"], (o) => o, opts))).toEqual(["Bank"]);
		expect(items(rankMatches("ba", ["Bank", "bank"], (o) => o, opts))).toEqual(["bank"]);
		// Still ranked: the prefix match comes before the mid-word one.
		expect(items(rankMatches("c", ["Aqua Carpatica", "cobalt"], (o) => o, opts))).toEqual([
			"cobalt",
			"Aqua Carpatica",
		]);
		// No fuzzy widening in case-sensitive mode.
		expect(items(rankMatches("KG", ["Kawa Górska"], (o) => o, opts))).toEqual([]);
		expect(items(rankMatches("KG", ["Kawa Górska"], (o) => o, { limit: 200 }))).toEqual([
			"Kawa Górska",
		]);
	});

	it("highlights the case-sensitive occurrence when caseSensitive", () => {
		expect(
			rankMatches("c", ["Aqua Carpatica"], (o) => o, { limit: 200, caseSensitive: true }),
		).toEqual([{ item: "Aqua Carpatica", matches: [[12, 13]] }]);
	});

	it("ranks by the projected text", () => {
		const files = [
			{ label: "Ada", path: "People/Ada.md" },
			{ label: "Notes", path: "Archive/People/Notes.md" },
		];
		expect(
			rankMatches("people", files, (f) => `${f.label} ${f.path}`, { limit: 200 }).map(
				({ item }) => item.label,
			),
		).toEqual(["Ada", "Notes"]);
	});
});
