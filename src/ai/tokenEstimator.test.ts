import { describe, expect, it } from "vitest";
import { estimateModelInputBudget, estimateTokenCount } from "./tokenEstimator";

describe("tokenEstimator", () => {
	it("estimates empty input as zero tokens", () => {
		expect(estimateTokenCount("")).toBe(0);
	});

	it("uses a lightweight ASCII estimate", () => {
		expect(estimateTokenCount("abcdefghijklmnop")).toBe(4);
	});

	it("uses UTF-8 byte length for non-ASCII text", () => {
		expect(estimateTokenCount("日本語")).toBe(3);
		expect(estimateTokenCount("😀")).toBe(2);
	});

	it("reserves less than the full model context for prompt input", () => {
		expect(estimateModelInputBudget(1000)).toBe(450);
		expect(estimateModelInputBudget(0)).toBe(1);
	});
});
