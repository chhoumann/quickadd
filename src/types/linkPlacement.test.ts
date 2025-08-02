import { describe, expect, it } from "vitest";
import {
	type LinkPlacement,
	type AppendLinkOptions,
	isAppendLinkOptions,
	normalizeAppendLinkOptions,
	isAppendLinkEnabled,
} from "./linkPlacement";

describe("LinkPlacement", () => {
	describe("isAppendLinkOptions", () => {
		it("should return true for AppendLinkOptions object", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "newLine",
			};
			expect(isAppendLinkOptions(options)).toBe(true);
		});

		it("should return false for boolean values", () => {
			expect(isAppendLinkOptions(true)).toBe(false);
			expect(isAppendLinkOptions(false)).toBe(false);
		});

		it("should return false for null or undefined", () => {
			expect(isAppendLinkOptions(null as any)).toBe(false);
			expect(isAppendLinkOptions(undefined as any)).toBe(false);
		});
	});

	describe("normalizeAppendLinkOptions", () => {
		it("should return the same object when already AppendLinkOptions", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "afterSelection",
			};
			expect(normalizeAppendLinkOptions(options)).toBe(options);
		});

		it("should convert true to enabled with default placement", () => {
			const result = normalizeAppendLinkOptions(true);
			expect(result).toEqual({
				enabled: true,
				placement: "replaceSelection",
			});
		});

		it("should convert false to disabled with default placement", () => {
			const result = normalizeAppendLinkOptions(false);
			expect(result).toEqual({
				enabled: false,
				placement: "replaceSelection",
			});
		});
	});

	describe("isAppendLinkEnabled", () => {
		it("should return enabled value from AppendLinkOptions", () => {
			const enabledOptions: AppendLinkOptions = {
				enabled: true,
				placement: "endOfLine",
			};
			const disabledOptions: AppendLinkOptions = {
				enabled: false,
				placement: "replaceSelection",
			};

			expect(isAppendLinkEnabled(enabledOptions)).toBe(true);
			expect(isAppendLinkEnabled(disabledOptions)).toBe(false);
		});

		it("should return boolean value directly", () => {
			expect(isAppendLinkEnabled(true)).toBe(true);
			expect(isAppendLinkEnabled(false)).toBe(false);
		});
	});

	describe("LinkPlacement type", () => {
		it("should accept all valid placement values", () => {
			const placements: LinkPlacement[] = [
				"replaceSelection",
				"afterSelection",
				"endOfLine",
				"newLine",
			];

			for (const placement of placements) {
				const options: AppendLinkOptions = {
					enabled: true,
					placement,
				};
				expect(options.placement).toBe(placement);
			}
		});
	});
});
