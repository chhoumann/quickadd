import { describe, expect, it } from "vitest";
import { suggestInserts } from "../../../tests/suggesters/formatSuggesterHarness";

describe("FormatSyntaxSuggester {{LINKSECTION}} (shared {{LINK prefix)", () => {
	it("offers both link tokens at the ambiguous {{LINK prefix", async () => {
		const s = await suggestInserts("{{link");
		expect(s).toContain("{{LINKCURRENT}}");
		expect(s).toContain("{{LINKSECTION}}");
	});

	it("narrows to linkcurrent only once disambiguated by 'c'", async () => {
		const s = await suggestInserts("{{linkc");
		expect(s).toContain("{{LINKCURRENT}}");
		expect(s).not.toContain("{{LINKSECTION}}");
	});

	it("narrows to linksection only once disambiguated by 's'", async () => {
		const s = await suggestInserts("{{links");
		expect(s).toContain("{{LINKSECTION}}");
		expect(s).not.toContain("{{LINKCURRENT}}");
	});

	it("still completes the full {{LINKSECTION}} token", async () => {
		const s = await suggestInserts("{{linksection");
		expect(s).toContain("{{LINKSECTION}}");
	});
});
