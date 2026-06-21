import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAnonymousValueOptions, parseValueToken } from "./valueSyntax";
import { log } from "../logger/logManager";

describe("valueSyntax audit (formatter-core)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("invalid |case style warns (value-syntax-case-transform / format-core-value-case)", () => {
		it("warns and drops an unrecognized |case style on a named/single token", () => {
			const warnSpy = vi
				.spyOn(log, "logWarning")
				.mockImplementation(() => {});

			const parsed = parseValueToken("title|case:keb");

			expect(parsed?.caseStyle).toBeUndefined();
			expect(
				warnSpy.mock.calls.some((c) =>
					String(c[0]).includes("Unsupported |case style"),
				),
			).toBe(true);
		});

		it("warns for a common typo like case:uppercase", () => {
			const warnSpy = vi
				.spyOn(log, "logWarning")
				.mockImplementation(() => {});

			parseValueToken("x|case:uppercase");

			expect(warnSpy).toHaveBeenCalled();
		});

		it("does NOT warn for a valid |case style", () => {
			const warnSpy = vi
				.spyOn(log, "logWarning")
				.mockImplementation(() => {});

			const parsed = parseValueToken("title|case:kebab");

			expect(parsed?.caseStyle).toBe("kebab");
			expect(
				warnSpy.mock.calls.some((c) =>
					String(c[0]).includes("Unsupported |case style"),
				),
			).toBe(false);
		});

		it("stays silent in quiet mode (preflight pre-pass)", () => {
			const warnSpy = vi
				.spyOn(log, "logWarning")
				.mockImplementation(() => {});

			parseValueToken("title|case:keb", { quiet: true });

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it("warns for an invalid |case on the anonymous form", () => {
			const warnSpy = vi
				.spyOn(log, "logWarning")
				.mockImplementation(() => {});

			const parsed = parseAnonymousValueOptions("|case:keb");

			expect(parsed.caseStyle).toBeUndefined();
			expect(
				warnSpy.mock.calls.some((c) =>
					String(c[0]).includes("Unsupported |case style"),
				),
			).toBe(true);
		});

		it("stays silent on the anonymous form in quiet mode (prompt-context pre-pass)", () => {
			// The formatter calls parseAnonymousValueOptions twice per token (a
			// quiet prompt-context pre-pass + the real replacer). Only the
			// replacer warns, so the |case typo notice fires once, not twice.
			const warnSpy = vi
				.spyOn(log, "logWarning")
				.mockImplementation(() => {});

			const parsed = parseAnonymousValueOptions("|case:keb", { quiet: true });

			expect(parsed.caseStyle).toBeUndefined();
			expect(warnSpy).not.toHaveBeenCalled();
		});
	});

	describe("bare |custom on a single value (value-syntax-custom-input)", () => {
		it("warns and does not pre-fill the prompt with the literal word 'custom'", () => {
			const warnSpy = vi
				.spyOn(log, "logWarning")
				.mockImplementation(() => {});

			const parsed = parseValueToken("notes|custom");

			// Before the fix, defaultValue was the literal "custom".
			expect(parsed?.defaultValue).toBe("");
			expect(parsed?.allowCustomInput).toBe(false);
			expect(
				warnSpy.mock.calls.some((c) =>
					String(c[0]).includes("|custom needs an option list"),
				),
			).toBe(true);
		});

		it("still honors |custom on an option-list token (no warning)", () => {
			const warnSpy = vi
				.spyOn(log, "logWarning")
				.mockImplementation(() => {});

			const parsed = parseValueToken("a,b|custom");

			expect(parsed?.allowCustomInput).toBe(true);
			expect(
				warnSpy.mock.calls.some((c) =>
					String(c[0]).includes("|custom needs an option list"),
				),
			).toBe(false);
		});
	});
});
