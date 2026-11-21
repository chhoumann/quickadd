import { describe, expect, it } from "vitest";
import { prepareCapture, surroundCapture } from "./capturePlacement";

describe("Capture cursor markers", () => {
	it("uses UTF-16 positions and strips every case-insensitive marker", () => {
		expect(prepareCapture("😀 {{cursor}}middle{{CURSOR}} end")).toEqual({
			content: "😀 middle end",
			cursor: { kind: "offset", source: "marker", value: 3 },
		});
	});
	it("keeps a marker at offset zero", () => {
		expect(prepareCapture("{{CURSOR}}text").cursor).toEqual({ kind: "offset", source: "marker", value: 0 });
	});
	it.each(["{{CURSOR}}", " \n{{cursor}}\t{{CURSOR}}", ""])("treats %j as an empty capture", input => {
		expect(prepareCapture(input).cursor).toEqual({ kind: "none" });
	});
	it("keeps non-ASCII spaces and defaults unmarked content to its end", () => {
		expect(prepareCapture("\u00a0")).toEqual({ content: "\u00a0", cursor: { kind: "offset", source: "defaultEnd", value: 1 } });
	});
	it("moves a marker with a generated heading but not a following anchor", () => {
		expect(surroundCapture(prepareCapture("before{{CURSOR}}after"), "## Log\n", "\n## Next")).toEqual({
			content: "## Log\nbeforeafter\n## Next",
			cursor: { kind: "offset", source: "marker", value: 13 },
		});
	});
});
