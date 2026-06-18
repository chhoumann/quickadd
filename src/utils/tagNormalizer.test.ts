import { describe, expect, it } from "vitest";
import {
	normalizeFrontmatterTagValues,
	normalizeTag,
} from "./tagNormalizer";

describe("tagNormalizer", () => {
	it("normalizes single tags", () => {
		expect(normalizeTag("#work")).toBe("work");
		expect(normalizeTag(" work ")).toBe("work");
		expect(normalizeTag(1)).toBe("1");
		expect(normalizeTag(false)).toBe("false");
	});

	it("ignores null and object-valued tags", () => {
		expect(normalizeTag(null)).toBe("");
		expect(normalizeTag(undefined)).toBe("");
		expect(normalizeTag({ tag: "work" })).toBe("");
	});

	it("splits scalar frontmatter tags on commas and whitespace", () => {
		expect(normalizeFrontmatterTagValues("work, project urgent")).toEqual([
			"work",
			"project",
			"urgent",
		]);
	});

	it("normalizes arrays without splitting array entries", () => {
		expect(normalizeFrontmatterTagValues(["#work", "project"])).toEqual([
			"work",
			"project",
		]);
	});

	it("drops empty and nested object frontmatter tag values", () => {
		expect(
			normalizeFrontmatterTagValues(["", "  ", null, { tag: "work" }, "#ok"]),
		).toEqual(["ok"]);
	});
});
