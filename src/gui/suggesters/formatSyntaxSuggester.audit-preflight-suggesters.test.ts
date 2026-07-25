import { describe, expect, it } from "vitest";
import { suggestInserts } from "../../../tests/suggesters/formatSuggesterHarness";

describe("FormatSyntaxSuggester file-name token gating", () => {
	// Finding: format-core-file-options
	it("does NOT offer {{FILE:<folder>|optional}} in the file-name field", async () => {
		const suggestions = await suggestInserts("{{FILE", { context: "fileName" });
		expect(suggestions).toContain("{{FILE:<folder>}}");
		expect(suggestions).not.toContain("{{FILE:<folder>|optional}}");
		// |link / |path stay gated too
		expect(suggestions).not.toContain("{{FILE:<folder>|link}}");
		expect(suggestions).not.toContain("{{FILE:<folder>|path}}");
	});

	it("gates the same variants in the capture target field, which is also a path", async () => {
		const suggestions = await suggestInserts("{{FILE", {
			context: "captureTarget",
		});
		expect(suggestions).toContain("{{FILE:<folder>}}");
		expect(suggestions).not.toContain("{{FILE:<folder>|optional}}");
		expect(suggestions).not.toContain("{{FILE:<folder>|link}}");
		expect(suggestions).not.toContain("{{FILE:<folder>|path}}");
	});

	it("still offers {{FILE:<folder>|optional}} in note bodies", async () => {
		const suggestions = await suggestInserts("{{FILE");
		expect(suggestions).toContain("{{FILE:<folder>|optional}}");
		expect(suggestions).toContain("{{FILE:<folder>|link}}");
		expect(suggestions).toContain("{{FILE:<folder>|path}}");
	});

	// Finding: format-file-filenamecurrent-token
	it("offers {{FILENAMECURRENT}} in the file-name field", async () => {
		const suggestions = await suggestInserts("{{FILENAME", {
			context: "fileName",
		});
		expect(suggestions).toContain("{{FILENAMECURRENT}}");
	});
});
