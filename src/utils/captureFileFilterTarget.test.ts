import { describe, expect, it } from "vitest";
import { parseCaptureFileFilterTarget } from "./captureFileFilterTarget";

describe("parseCaptureFileFilterTarget", () => {
	it("parses a hashtag target with additional tag filters", () => {
		expect(parseCaptureFileFilterTarget("#work|tag:project")).toEqual({
			filter: { tags: ["work", "project"] },
			multiSelect: false,
		});
	});

	it("parses tag: filters without requiring a leading #", () => {
		expect(parseCaptureFileFilterTarget("tag:work|tag:#project")).toEqual({
			filter: { tags: ["work", "project"] },
			multiSelect: false,
		});
	});

	it("parses repeated folders as an include union", () => {
		expect(
			parseCaptureFileFilterTarget(
				"folder:Goals|folder:Projects|tag:active",
			),
		).toEqual({
			filter: {
				folder: "Goals",
				folders: ["Goals", "Projects"],
				tags: ["active"],
			},
			multiSelect: false,
		});
	});

	it("does not parse literal paths", () => {
		expect(parseCaptureFileFilterTarget("Projects/Alpha.md")).toBeNull();
	});

	it("reports but does not apply multi-select semantics", () => {
		expect(parseCaptureFileFilterTarget("tag:work|multi")).toEqual({
			filter: { tags: ["work"] },
			multiSelect: true,
		});
	});
});
