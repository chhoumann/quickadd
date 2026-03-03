import { describe, expect, it } from "vitest";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { flattenChoices, flattenChoicesWithPath } from "./choiceUtils";

describe("choiceUtils", () => {
	it("flattens nested choices with breadcrumb segments", () => {
		const leafA: IChoice = {
			id: "a",
			name: "A",
			type: "Template",
			command: true,
		};
		const leafB: IChoice = {
			id: "b",
			name: "B",
			type: "Capture",
			command: false,
		};
		const nested: IMultiChoice = {
			id: "nested",
			name: "Nested",
			type: "Multi",
			command: false,
			placeholder: "Select",
			collapsed: false,
			choices: [leafB],
		};
		const root: IMultiChoice = {
			id: "root",
			name: "Root",
			type: "Multi",
			command: false,
			placeholder: "Select",
			collapsed: false,
			choices: [leafA, nested],
		};

		const flattened = flattenChoices([root]);
		expect(flattened.map((choice) => choice.id)).toEqual([
			"root",
			"a",
			"nested",
			"b",
		]);

		const withPath = flattenChoicesWithPath([root]);
		expect(
			withPath.map(({ choice, pathSegments }) => ({
				id: choice.id,
				path: pathSegments.join(" / "),
			})),
		).toEqual([
			{ id: "root", path: "Root" },
			{ id: "a", path: "Root / A" },
			{ id: "nested", path: "Root / Nested" },
			{ id: "b", path: "Root / Nested / B" },
		]);
	});
});
