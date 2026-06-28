import { describe, it, expect } from "vitest";
import { splitWikilinkAwareList } from "./splitWikilinkAwareList";

describe("splitWikilinkAwareList", () => {
	it("keeps a comma inside a single wikilink attached to its link", () => {
		expect(splitWikilinkAwareList("[[Note, with comma]]")).toEqual([
			"[[Note, with comma]]",
		]);
	});

	it("splits a list while preserving commas inside each wikilink", () => {
		expect(
			splitWikilinkAwareList("[[Plain Note]], [[Another, with comma]]"),
		).toEqual(["[[Plain Note]]", "[[Another, with comma]]"]);
	});

	it("still splits plain comma lists (byte-identical to the old behaviour)", () => {
		expect(splitWikilinkAwareList("work, project, urgent")).toEqual([
			"work",
			"project",
			"urgent",
		]);
	});

	it("preserves a comma inside a wikilink alias", () => {
		expect(splitWikilinkAwareList("[[Page|Alias, label]]")).toEqual([
			"[[Page|Alias, label]]",
		]);
	});

	it("preserves a comma inside an embed", () => {
		expect(splitWikilinkAwareList("![[Image, v2.png]]")).toEqual([
			"![[Image, v2.png]]",
		]);
	});

	it("mixes wikilinks and plain values", () => {
		expect(
			splitWikilinkAwareList("[[A, b]], plain, [[C]]"),
		).toEqual(["[[A, b]]", "plain", "[[C]]"]);
	});

	it("returns a single trimmed value when there is no comma", () => {
		expect(splitWikilinkAwareList("  single value  ")).toEqual([
			"single value",
		]);
	});

	it("drops empty fragments from trailing/duplicate commas", () => {
		expect(splitWikilinkAwareList("a,, b, ")).toEqual(["a", "b"]);
	});

	it("treats an unbalanced wikilink open as one value (no spurious split)", () => {
		expect(splitWikilinkAwareList("[[Unclosed, link")).toEqual([
			"[[Unclosed, link",
		]);
	});

	it("returns an empty array for an empty or whitespace string", () => {
		expect(splitWikilinkAwareList("")).toEqual([]);
		expect(splitWikilinkAwareList("   ")).toEqual([]);
	});
});
