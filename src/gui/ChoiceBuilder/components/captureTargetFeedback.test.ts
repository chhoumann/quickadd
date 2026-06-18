import { describe, expect, it } from "vitest";
import { getCaptureTargetFeedback } from "./captureTargetFeedback";

describe("getCaptureTargetFeedback", () => {
	it("returns null for ordinary capture paths", () => {
		expect(getCaptureTargetFeedback("Inbox.md")).toBeNull();
		expect(getCaptureTargetFeedback("Projects/{{DATE}}.md")).toBeNull();
	});

	it("recognizes repeated folder and tag filters", () => {
		const feedback = getCaptureTargetFeedback(
			"folder:Goals|folder:Projects|tag:active|tag:work",
		);

		expect(feedback).toMatchObject({
			recognized: true,
			valid: true,
			variant: "success",
		});
		expect(feedback?.message).toContain("Recognized filtered picker");
		expect(feedback?.message).toContain("folders Goals or Projects");
		expect(feedback?.message).toContain("tags active + work");
	});

	it("recognizes hashtag targets with additional tag filters", () => {
		const feedback = getCaptureTargetFeedback("#work|tag:#project");

		expect(feedback).toMatchObject({
			recognized: true,
			valid: true,
			variant: "success",
		});
		expect(feedback?.message).toContain("tags work + project");
	});

	it("normalizes leading vault slashes before classifying targets", () => {
		expect(getCaptureTargetFeedback("/property:type=draft")).toMatchObject({
			recognized: true,
			valid: true,
			variant: "success",
			message: expect.stringContaining("frontmatter type = draft"),
		});
	});

	it("rejects capture-target multi-select filters with runtime-aligned guidance", () => {
		expect(getCaptureTargetFeedback("tag:work|multi")).toMatchObject({
			recognized: true,
			valid: false,
			variant: "error",
			message:
				"Capture target filters select one destination file. Use {{FILE:...|multi}} in the capture format for multi-value metadata.",
		});
	});

	it("accepts false multi flags because runtime treats them as single-select", () => {
		expect(getCaptureTargetFeedback("tag:work|multi:false")).toMatchObject({
			recognized: true,
			valid: true,
			variant: "success",
		});
		expect(getCaptureTargetFeedback("tag:work|multi:off")).toMatchObject({
			recognized: true,
			valid: true,
			variant: "success",
		});
	});

	it("summarizes property targets and honored pipe filters", () => {
		const feedback = getCaptureTargetFeedback(
			"property:type=draft|folder:Notes|exclude-tag:done",
		);

		expect(feedback).toMatchObject({
			recognized: true,
			valid: true,
			variant: "success",
		});
		expect(feedback?.message).toContain("Recognized property target");
		expect(feedback?.message).toContain("frontmatter type = draft");
		expect(feedback?.message).toContain("folder Notes");
		expect(feedback?.message).toContain("excluding tag done");
	});

	it("rejects property targets without a field name", () => {
		expect(getCaptureTargetFeedback("property:")).toMatchObject({
			recognized: true,
			valid: false,
			variant: "error",
			message:
				"Property capture target needs a field name, e.g. property:type=draft.",
		});
		expect(getCaptureTargetFeedback("property:=draft")).toMatchObject({
			recognized: true,
			valid: false,
			variant: "error",
		});
	});
});
