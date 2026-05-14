import { describe, expect, it } from "vitest";
import { formatUnknownValue } from "./conditionalHelpers";

describe("formatUnknownValue", () => {
	it("preserves existing formatting for ordinary values", () => {
		expect(formatUnknownValue("ready")).toBe("ready");
		expect(formatUnknownValue(42)).toBe("42");
		expect(formatUnknownValue(true)).toBe("true");
		expect(formatUnknownValue(null)).toBe("");
		expect(formatUnknownValue(undefined)).toBe("");
		expect(formatUnknownValue(["alpha", "beta"])).toBe('["alpha","beta"]');
		expect(formatUnknownValue({ status: "ready" })).toBe('{"status":"ready"}');
	});

	it("uses a fallback when JSON.stringify returns undefined", () => {
		function namedFormatterFallback() {
			return "not used";
		}

		const jsonUndefinedObject = {
			toJSON: () => undefined,
		};

		expect(formatUnknownValue(namedFormatterFallback)).toBe("[object Function]");
		expect(formatUnknownValue(jsonUndefinedObject)).toBe("[object Object]");
	});
});
