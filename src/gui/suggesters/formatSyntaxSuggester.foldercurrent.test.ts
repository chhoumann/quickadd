import { describe, expect, it } from "vitest";
import { suggestInserts } from "../../../tests/suggesters/formatSuggesterHarness";

describe("FormatSyntaxSuggester {{FOLDERCURRENT}} (shared {{FOLDER prefix)", () => {
	it("offers {{FOLDERCURRENT}} in note bodies", async () => {
		const s = await suggestInserts("{{foldercurrent");
		expect(s).toContain("{{FOLDERCURRENT}}");
	});

	it("offers {{FOLDERCURRENT}} in the capture target field (#1480)", async () => {
		const s = await suggestInserts("{{foldercurrent", { context: "captureTarget" });
		expect(s).toContain("{{FOLDERCURRENT}}");
	});

	it("narrows to foldercurrent only once disambiguated by 'c'", async () => {
		const s = await suggestInserts("{{folderc");
		expect(s).toContain("{{FOLDERCURRENT}}");
		// {{FOLDER|name}} lives only in the file-name set, and no bare {{FOLDER}}
		// completion should survive the 'c'.
		expect(s.some((x) => /^\{\{FOLDER\}?\}?$/i.test(x))).toBe(false);
	});

	it("offers both folder tokens at the ambiguous {{FOLDER prefix in a file name", async () => {
		const s = await suggestInserts("{{folder", { context: "fileName" });
		expect(s).toContain("{{FOLDER|name}}");
		expect(s).toContain("{{FOLDERCURRENT|name}}");
	});

	it("offers only the |name form in a file name (full-path nesting footgun)", async () => {
		const s = await suggestInserts("{{folderc", { context: "fileName" });
		expect(s).toContain("{{FOLDERCURRENT|name}}");
		expect(s).not.toContain("{{FOLDERCURRENT}}");
		expect(s).not.toContain("{{FOLDER|name}}");
	});

	it("withholds the token in line-target fields", async () => {
		// formatLocationString leaves {{FOLDERCURRENT}} literal in line selectors,
		// so those fields do not offer it — no suggester/runtime mismatch.
		const s = await suggestInserts("{{folderc", { context: "lineTarget" });
		expect(s).not.toContain("{{FOLDERCURRENT}}");
		// Other tokens are unaffected.
		const links = await suggestInserts("{{linkc", { context: "lineTarget" });
		expect(links).toContain("{{LINKCURRENT}}");
	});
});
