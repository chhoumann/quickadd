import { describe, it, expect } from "vitest";
import { isUnderAllowedRoot, isWithinAllowedRoots, normalizeRoot } from "./allowedRoots";

// "Cafe" with an accented final e, in both Unicode normalization forms. Built from
// an explicit decomposed source (e + combining acute) so the two are byte-distinct.
const CAFE_BASE = "Café";
const CAFE_NFC = CAFE_BASE.normalize("NFC"); // composed   (Caf + U+00E9)
const CAFE_NFD = CAFE_BASE.normalize("NFD"); // decomposed (Cafe + U+0301)

describe("normalizeRoot", () => {
	it("trims, unifies separators, strips slashes, and NFC-normalizes a config root", () => {
		expect(normalizeRoot("  AI/  ")).toBe("AI");
		expect(normalizeRoot("\\AI\\notes\\")).toBe("AI/notes");
		expect(normalizeRoot("AI//notes")).toBe("AI/notes");
		expect(normalizeRoot(CAFE_NFD)).toBe(CAFE_NFC);
	});
	it("collapses an all-blank root to empty", () => {
		expect(normalizeRoot("   ")).toBe("");
		expect(normalizeRoot("")).toBe("");
	});
});

describe("isUnderAllowedRoot", () => {
	it("is segment-aware (root itself or a child, never a prefix sibling)", () => {
		expect(isUnderAllowedRoot("AI", ["AI"])).toBe(true);
		expect(isUnderAllowedRoot("AI/x.md", ["AI"])).toBe(true);
		expect(isUnderAllowedRoot("AInotes/x.md", ["AI"])).toBe(false);
		expect(isUnderAllowedRoot("Other/x.md", ["AI"])).toBe(false);
	});
});

describe("isWithinAllowedRoots", () => {
	it("absent or all-blank roots are vault-wide (identical)", () => {
		for (const roots of [undefined, [], [""], ["  "], ["", "  "]]) {
			expect(isWithinAllowedRoots("Anywhere/secret.md", roots)).toBe(true);
		}
	});

	it("confines an in-fence path and rejects an out-of-fence one", () => {
		expect(isWithinAllowedRoots("AI/scratch.md", ["AI"])).toBe(true);
		expect(isWithinAllowedRoots("Secret/passwords.md", ["AI"])).toBe(false);
	});

	it("denies an unknown path when confined", () => {
		expect(isWithinAllowedRoots(undefined, ["AI"])).toBe(false);
		expect(isWithinAllowedRoots("", ["AI"])).toBe(false);
	});

	// Regression: the predicate must compare the app-owned path by IDENTITY. A prior
	// version ran the path through normalizeRoot (which .trim()s), so a sibling folder
	// literally named " AI" trimmed to "AI/..." and slipped past the fence.
	it("does NOT trim the path: a leading-space sibling folder stays out of scope", () => {
		expect(isWithinAllowedRoots(" AI/secret.md", ["AI"])).toBe(false);
		// A real in-fence path is unaffected.
		expect(isWithinAllowedRoots("AI/secret.md", ["AI"])).toBe(true);
	});

	// Regression: a genuinely in-root NFD path under an NFC root must MATCH (else
	// confinement wrongly hides the user's own note on macOS / imported vaults).
	it("matches across Unicode normalization forms (NFC root vs NFD path)", () => {
		expect(isWithinAllowedRoots(`${CAFE_NFD}/notes/x.md`, [CAFE_NFC])).toBe(true);
		expect(isWithinAllowedRoots(`${CAFE_NFC}/x.md`, [CAFE_NFC])).toBe(true);
	});

	it("honors multiple roots and accepts a trailing-slash / backslash root spelling", () => {
		expect(isWithinAllowedRoots("Notes/x.md", ["AI", "Notes"])).toBe(true);
		expect(isWithinAllowedRoots("AI/x.md", ["AI/"])).toBe(true);
		expect(isWithinAllowedRoots("AI/sub/x.md", ["AI\\sub"])).toBe(true);
	});
});
