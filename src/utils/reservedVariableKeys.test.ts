import { describe, expect, it } from "vitest";
import { isReservedVariableKey } from "./reservedVariableKeys";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "../constants";

describe("isReservedVariableKey", () => {
	it("flags the reserved internal capture-target key", () => {
		expect(isReservedVariableKey(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH)).toBe(
			true,
		);
	});

	it("flags any key in the reserved __qa. namespace", () => {
		expect(isReservedVariableKey("__qa.somethingNew")).toBe(true);
		expect(isReservedVariableKey("__qa.")).toBe(true);
	});

	// QuickAdd resolves variable names case-insensitively, so the guard must too -
	// otherwise a value-__QA.captureTargetFilePath variant would slip past it.
	it("flags reserved keys case-insensitively", () => {
		expect(isReservedVariableKey("__QA.captureTargetFilePath")).toBe(true);
		expect(isReservedVariableKey("__Qa.captureTargetFilePath")).toBe(true);
		expect(isReservedVariableKey("__qA.somethingNew")).toBe(true);
	});

	it("does not flag ordinary user variable names", () => {
		expect(isReservedVariableKey("value")).toBe(false);
		expect(isReservedVariableKey("title")).toBe(false);
		expect(isReservedVariableKey("captureTargetFilePath")).toBe(false);
		// A near-miss that does not start with the prefix is not reserved.
		expect(isReservedVariableKey("my__qa.value")).toBe(false);
		expect(isReservedVariableKey("__qaTool")).toBe(false);
	});
});
