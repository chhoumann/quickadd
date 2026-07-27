import { describe, expect, it } from "vitest";
import {
	assertCreatableFilePath,
	isCreatableFilePath,
} from "./assertCreatableFilePath";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";

/**
 * Issue #1591. The rule itself (which characters, and why only those) is
 * measured and pinned in `fileNameDisplayFormatter-1578-illegal-chars.test.ts`;
 * this file pins the RUN-side wrapper: what it throws, and what it says.
 */
describe("assertCreatableFilePath", () => {
	it("aborts the choice for a name Obsidian refuses", () => {
		expect(() => assertCreatableFilePath("Notes/Bad: My Note.md")).toThrow(
			ChoiceAbortError,
		);
	});

	it("names the path and the character, in the run's tense", () => {
		// The preview's sentence ends "would fail at run time"; by here the choice
		// IS stopping and the name is known, so the wording differs - but the
		// character list and the {{TIME}} hint are shared, so the rule cannot
		// drift between the surface that warns and the code that stops.
		expect(() => assertCreatableFilePath("Bad: My Note.md")).toThrow(
			'Cannot create "Bad: My Note.md": a file or folder name cannot contain ":". Check your own text and tokens like {{TIME}}, which is HH:mm.',
		);
	});

	it("fires on a colon in a FOLDER segment, which Obsidian refuses too", () => {
		// QuickAddEngine.createFileWithInput creates the parent folder before
		// vault.create, so this is the first thing that would have failed.
		expect(() => assertCreatableFilePath("Meetings: 2026/Note.md")).toThrow(
			ChoiceAbortError,
		);
	});

	it("allows the separators QuickAdd creates folders for", () => {
		expect(() =>
			assertCreatableFilePath("Notes/Sub/My Note.md"),
		).not.toThrow();
	});

	it("allows characters Obsidian creates without complaint", () => {
		// Measured against vault.create on Obsidian 1.13.0 (macOS): these all
		// succeed, so rejecting them would break working setups (#1595).
		expect(() =>
			assertCreatableFilePath(`Notes/a*b?c"d<e>f|g^h[i]j#k.md`),
		).not.toThrow();
	});

	it("exposes the same rule as a predicate for callers that decline quietly", () => {
		expect(isCreatableFilePath("Notes/My Note.md")).toBe(true);
		expect(isCreatableFilePath("Notes/Bad: My Note.md")).toBe(false);
	});
});
