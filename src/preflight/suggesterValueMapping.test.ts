import { describe, expect, it } from "vitest";
import { resolveDropdownInitialValue } from "./suggesterValueMapping";

describe("resolveDropdownInitialValue", () => {
	it("uses the first raw option when starting empty", () => {
		expect(
			resolveDropdownInitialValue("", ["#BF616A", "#8CC570"]),
		).toBe("#BF616A");
	});

	it("preserves non-empty starting values that still exist in options", () => {
		expect(
			resolveDropdownInitialValue("#8CC570", ["#BF616A", "#8CC570"]),
		).toBe("#8CC570");
	});

	it("normalizes stale non-empty starting values to the first raw option", () => {
		expect(
			resolveDropdownInitialValue("stale", ["#BF616A", "#8CC570"]),
		).toBe("#BF616A");
	});

	it("preserves starting values when there are no options", () => {
		expect(resolveDropdownInitialValue("", [])).toBe("");
		expect(resolveDropdownInitialValue("existing", [])).toBe("existing");
	});
});
