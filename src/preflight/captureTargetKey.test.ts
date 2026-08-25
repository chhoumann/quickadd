import { describe, expect, it } from "vitest";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "src/constants";
import { isReservedVariableKey } from "src/utils/reservedVariableKeys";
import {
	captureTargetKeyFor,
	isCaptureTargetKey,
	isScopedCaptureTargetKey,
	readPreselectedCaptureTarget,
	resolveCaptureTargetVariableKey,
	unscopedAliasSatisfiesSoleCaptureTarget,
} from "./captureTargetKey";

describe("captureTargetKeyFor", () => {
	it("builds a branded scoped key from the unscoped constant and choice id", () => {
		const key = captureTargetKeyFor("choice-a");
		expect(key).toBe(`${QA_INTERNAL_CAPTURE_TARGET_FILE_PATH}.choice-a`);
		expect(isCaptureTargetKey(key)).toBe(true);
	});

	it("produces different keys for different choice ids", () => {
		expect(captureTargetKeyFor("choice-a")).not.toBe(
			captureTargetKeyFor("choice-b"),
		);
	});

	it("keeps every produced key in the reserved namespace", () => {
		expect(isReservedVariableKey(captureTargetKeyFor("choice-a"))).toBe(true);
		expect(isReservedVariableKey(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH)).toBe(
			true,
		);
	});

	it("recognizes the legacy unscoped constant as a capture-target key", () => {
		expect(isCaptureTargetKey(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH)).toBe(
			true,
		);
		expect(isCaptureTargetKey("value")).toBe(false);
		expect(isCaptureTargetKey(`${QA_INTERNAL_CAPTURE_TARGET_FILE_PATH}.`)).toBe(
			false,
		);
	});
});

describe("readPreselectedCaptureTarget", () => {
	it("prefers the scoped key over the unscoped alias", () => {
		const variables = new Map<string, unknown>([
			[captureTargetKeyFor("cap-1"), "Inbox/Scoped.md"],
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Inbox/Unscoped.md"],
		]);

		expect(readPreselectedCaptureTarget(variables, "cap-1")).toBe(
			"Inbox/Scoped.md",
		);
	});

	it("falls back to the unscoped alias when the scoped key is absent", () => {
		const variables = new Map<string, unknown>([
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Inbox/Unscoped.md"],
		]);

		expect(readPreselectedCaptureTarget(variables, "cap-1")).toBe(
			"Inbox/Unscoped.md",
		);
	});

	it("ignores blank and non-string values", () => {
		const blankScoped = new Map<string, unknown>([
			[captureTargetKeyFor("cap-1"), ""],
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Inbox/Unscoped.md"],
		]);
		expect(readPreselectedCaptureTarget(blankScoped, "cap-1")).toBe(
			"Inbox/Unscoped.md",
		);

		const blankBoth = new Map<string, unknown>([
			[captureTargetKeyFor("cap-1"), ""],
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, ""],
		]);
		expect(readPreselectedCaptureTarget(blankBoth, "cap-1")).toBeUndefined();

		const nonString = new Map<string, unknown>([
			[captureTargetKeyFor("cap-1"), 12],
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, null],
		]);
		expect(readPreselectedCaptureTarget(nonString, "cap-1")).toBeUndefined();
	});
});

describe("resolveCaptureTargetVariableKey", () => {
	it("does not treat the unscoped alias as the scoped requirement's own key", () => {
		const requirementId = captureTargetKeyFor("cap-1");
		const variables = new Map<string, unknown>([
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Inbox/Unscoped.md"],
		]);

		expect(resolveCaptureTargetVariableKey(variables, requirementId)).toBeNull();
		expect(
			unscopedAliasSatisfiesSoleCaptureTarget(variables, requirementId, 1),
		).toBe(true);
		expect(
			unscopedAliasSatisfiesSoleCaptureTarget(variables, requirementId, 2),
		).toBe(false);
		expect(isScopedCaptureTargetKey(requirementId)).toBe(true);
	});

	it("prefers a non-null scoped value when both keys are set", () => {
		const requirementId = captureTargetKeyFor("cap-1");
		const variables = new Map<string, unknown>([
			[requirementId, "Inbox/Scoped.md"],
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Inbox/Unscoped.md"],
		]);

		expect(resolveCaptureTargetVariableKey(variables, requirementId)).toBe(
			requirementId,
		);
	});

	it("does not treat a null scoped value as resolved when the alias is missing", () => {
		const requirementId = captureTargetKeyFor("cap-1");
		const variables = new Map<string, unknown>([[requirementId, null]]);

		expect(
			resolveCaptureTargetVariableKey(variables, requirementId),
		).toBeNull();
	});
});
