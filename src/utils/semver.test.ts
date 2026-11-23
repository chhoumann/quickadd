import { describe, expect, it } from "vitest";
import { parseSemver } from "./semver";

describe("parseSemver", () => {
	it("parses standard semantic versions", () => {
		expect(parseSemver("2.7.0")).toEqual({ major: 2, minor: 7, patch: 0 });
		expect(parseSemver("1.0.0")).toEqual({ major: 1, minor: 0, patch: 0 });
		expect(parseSemver("10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 });
	});

	it("handles pre-release versions", () => {
		expect(parseSemver("2.7.0-beta.1")).toEqual({ major: 2, minor: 7, patch: 0 });
		expect(parseSemver("2.7.0-alpha")).toEqual({ major: 2, minor: 7, patch: 0 });
		expect(parseSemver("2.7.0-rc.2")).toEqual({ major: 2, minor: 7, patch: 0 });
	});

	it("handles build metadata", () => {
		expect(parseSemver("2.7.0+123")).toEqual({ major: 2, minor: 7, patch: 0 });
		expect(parseSemver("2.7.0+20240101")).toEqual({ major: 2, minor: 7, patch: 0 });
	});

	it("handles both pre-release and build metadata", () => {
		expect(parseSemver("2.7.0-beta.1+123")).toEqual({ major: 2, minor: 7, patch: 0 });
	});

	it("returns null for invalid versions", () => {
		expect(parseSemver("")).toBeNull();
		expect(parseSemver("invalid")).toBeNull();
		expect(parseSemver("2.7")).toBeNull();
		expect(parseSemver("2")).toBeNull();
		expect(parseSemver("2.7.0.1")).toBeNull();
		expect(parseSemver("2.7.x")).toBeNull();
		expect(parseSemver("v2.7.0")).toBeNull();
	});

	it("handles null and undefined", () => {
		expect(parseSemver(null as unknown as string)).toBeNull();
		expect(parseSemver(undefined as unknown as string)).toBeNull();
	});

	it("handles negative numbers", () => {
		expect(parseSemver("-1.0.0")).toBeNull();
	});
});
