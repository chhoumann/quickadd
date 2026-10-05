import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatalogJson, CATALOG_PATH, cleanTitle, parseFrontmatter, recipeFrom } from "../scripts/build-recipes.mjs";

const PAGE = `---
title: "Template: Plan a trip"
description: Create a trip note with a packing list
slug: docs/Examples/Template_PlanATrip
package: trip
---

Body text: the catalogue reads the frontmatter only.
`;

const MANIFEST = {
	install: { requires: ["The **Calendar** plugin"], afterImport: ["Run **New trip** from the command palette."] },
};

const PACKAGE = {
	schemaVersion: 1,
	quickAddVersion: "2.30.0",
	createdAt: "2026-10-01T00:00:00.000Z",
	rootChoiceIds: ["qa-pkg-trip"],
	choices: [
		{ choice: { id: "qa-pkg-trip", name: "Trips", type: "Multi" }, pathHint: ["Trips"], parentChoiceId: null },
		{ choice: { id: "qa-pkg-trip-new", name: "New trip", type: "Template" }, pathHint: ["Trips", "New trip"], parentChoiceId: "qa-pkg-trip" },
		{ choice: { id: "qa-pkg-trip-pack", name: "Pack", type: "Macro" }, pathHint: ["Trips", "Pack"], parentChoiceId: "qa-pkg-trip" },
	],
	assets: [
		{ kind: "template", originalPath: "Templates/Trip.md", contentEncoding: "base64", content: "" },
		{ kind: "capture-template", originalPath: "Templates/Item.md", contentEncoding: "base64", content: "" },
		{ kind: "user-script", originalPath: "scripts/pack.js", contentEncoding: "base64", content: "" },
	],
};

describe("build-recipes", () => {
	it("makes a catalogue entry from a page, its manifest, and its package", () => {
		expect(recipeFrom("trip", parseFrontmatter(PAGE), MANIFEST, PACKAGE)).toEqual({
			id: "trip",
			title: "Plan a trip",
			description: "Create a trip note with a packing list",
			slug: "docs/Examples/Template_PlanATrip",
			requires: ["The **Calendar** plugin"],
			afterImport: ["Run **New trip** from the command palette."],
			choices: [
				{ name: "New trip", type: "Template" },
				{ name: "Pack", type: "Macro" },
			],
			scripts: 1,
			templates: 2,
			package: PACKAGE,
		});
	});

	it("gives a manifest without an install block no lines", () => {
		const recipe = recipeFrom("trip", parseFrontmatter(PAGE), {}, PACKAGE);
		expect([recipe.requires, recipe.afterImport]).toEqual([[], []]);
	});

	it("drops the choice-type prefix from a title", () => {
		expect(["Capture: Add a task", "Macro: Brain dump", "Template - My Book Notes", "Zettelizer"].map(cleanTitle)).toEqual([
			"Add a task",
			"Brain dump",
			"My Book Notes",
			"Zettelizer",
		]);
	});

	it("matches the committed catalogue, so a changed example rebuilds it", () => {
		const committed = readFileSync(CATALOG_PATH, "utf8").replace(/\r\n/g, "\n");
		expect(committed === buildCatalogJson(), 'Run "pnpm run build:recipes" and commit the catalogue.').toBe(true);
	});
});
