import { describe, expect, it } from "vitest";
import {
	ASK_DEFAULT_PRESETS,
	DATE_ORIGIN_PRESETS,
	askDefaultFromPresetId,
	askDefaultOptions,
	askDefaultToPresetId,
	anotherDayCommandId,
	choiceCommandId,
	dateOriginForPick,
	dateOriginFromPreset,
	dateOriginToPreset,
	isPickDateToken,
	shouldRegisterAnotherDayCommand,
} from "./dateOriginPresets";

describe("dateOrigin presets", () => {
	it("treats missing and now as Today", () => {
		expect(dateOriginToPreset(undefined)).toBe("today");
		expect(dateOriginToPreset({ kind: "now" })).toBe("today");
		expect(dateOriginFromPreset({ preset: "today" })).toBeUndefined();
	});

	it("round-trips every named job", () => {
		expect(dateOriginFromPreset({ preset: "yesterday" })).toEqual({
			kind: "relative",
			offset: -1,
			unit: "days",
		});
		expect(dateOriginFromPreset({ preset: "last-week" })).toEqual({
			kind: "relative",
			offset: -1,
			unit: "weeks",
		});
		expect(dateOriginFromPreset({ preset: "next-week" })).toEqual({
			kind: "relative",
			offset: 1,
			unit: "weeks",
		});
		expect(dateOriginFromPreset({ preset: "last-month" })).toEqual({
			kind: "relative",
			offset: -1,
			unit: "months",
		});

		expect(
			dateOriginToPreset({ kind: "relative", offset: -1, unit: "days" }),
		).toBe("yesterday");
		expect(
			dateOriginToPreset({ kind: "relative", offset: -1, unit: "weeks" }),
		).toBe("last-week");
		expect(
			dateOriginToPreset({ kind: "relative", offset: 1, unit: "weeks" }),
		).toBe("next-week");
		expect(
			dateOriginToPreset({ kind: "relative", offset: -1, unit: "months" }),
		).toBe("last-month");
	});

	it("keeps an unmatched relative offset as Custom", () => {
		const custom = { kind: "relative" as const, offset: -3, unit: "days" as const };
		expect(dateOriginToPreset(custom)).toBe("custom");
		expect(
			dateOriginFromPreset({ preset: "custom", previous: custom }),
		).toEqual(custom);
	});

	it("starts Custom on −2 days so it does not collapse into Yesterday", () => {
		expect(
			dateOriginFromPreset({
				preset: "custom",
				previous: { kind: "relative", offset: -1, unit: "weeks" },
			}),
		).toEqual({ kind: "relative", offset: -2, unit: "days" });
		expect(dateOriginFromPreset({ preset: "custom" })).toEqual({
			kind: "relative",
			offset: -2,
			unit: "days",
		});
	});

	it("seeds Ask from the named day you just left", () => {
		expect(
			dateOriginFromPreset({
				preset: "ask",
				previous: { kind: "relative", offset: -1, unit: "weeks" },
			}),
		).toEqual({ kind: "ask", defaultValue: "last week" });
		expect(
			dateOriginFromPreset({
				preset: "ask",
				previous: { kind: "relative", offset: -1, unit: "days" },
			}),
		).toEqual({ kind: "ask", defaultValue: "yesterday" });
		expect(dateOriginFromPreset({ preset: "ask" })).toEqual({ kind: "ask" });
	});

	it("keeps Ask and variable extras when the preset does not change", () => {
		expect(
			dateOriginFromPreset({
				preset: "ask",
				previous: { kind: "ask", defaultValue: "last week" },
			}),
		).toEqual({ kind: "ask", defaultValue: "last week" });
		expect(
			dateOriginFromPreset({
				preset: "variable",
				previous: { kind: "variable", name: "day" },
			}),
		).toEqual({ kind: "variable", name: "day" });
	});

	it("maps every preset to a stored origin except Today", () => {
		for (const preset of DATE_ORIGIN_PRESETS) {
			const origin = dateOriginFromPreset({ preset });
			if (preset === "today") {
				expect(origin).toBeUndefined();
			} else {
				expect(origin).toBeDefined();
			}
		}
	});
});

describe("ask picker defaults", () => {
	it("maps plain language and aliases onto the named days", () => {
		expect(askDefaultToPresetId(undefined)).toBe("today");
		expect(askDefaultToPresetId("today")).toBe("today");
		expect(askDefaultToPresetId("yd")).toBe("yesterday");
		expect(askDefaultToPresetId("lw")).toBe("last-week");
		expect(askDefaultToPresetId(" last week ")).toBe("last-week");
		expect(askDefaultToPresetId("nw")).toBe("next-week");
		expect(askDefaultToPresetId("lm")).toBe("last-month");
	});

	it("keeps an unknown stored default so it is not wiped", () => {
		expect(askDefaultToPresetId("last friday")).toBe("kept");
		expect(askDefaultOptions("last friday")).toEqual(
			expect.arrayContaining([{ value: "kept", label: "last friday" }]),
		);
		expect(askDefaultFromPresetId("kept", "last friday")).toBe("last friday");
	});

	it("writes readable picker values, not aliases", () => {
		expect(askDefaultFromPresetId("today")).toBeUndefined();
		expect(askDefaultFromPresetId("yesterday")).toBe("yesterday");
		expect(askDefaultFromPresetId("last-week")).toBe("last week");
		expect(askDefaultFromPresetId("next-week")).toBe("next week");
		expect(askDefaultFromPresetId("last-month")).toBe("last month");
	});

	it("lists every named ask default", () => {
		expect(ASK_DEFAULT_PRESETS.map((item) => item.id)).toEqual([
			"today",
			"yesterday",
			"last-week",
			"next-week",
			"last-month",
		]);
	});
});

describe("another-day command", () => {
	it("is off by default and only registers when opted in", () => {
		expect(
			shouldRegisterAnotherDayCommand({ origin: undefined }),
		).toBe(false);
		expect(
			shouldRegisterAnotherDayCommand({
				origin: { kind: "now" },
				enabled: false,
			}),
		).toBe(false);
		expect(
			shouldRegisterAnotherDayCommand({
				origin: undefined,
				enabled: true,
			}),
		).toBe(true);
		expect(
			shouldRegisterAnotherDayCommand({
				origin: { kind: "relative", offset: -1, unit: "days" },
				enabled: true,
			}),
		).toBe(true);
		expect(
			shouldRegisterAnotherDayCommand({
				origin: { kind: "ask" },
				enabled: true,
			}),
		).toBe(false);
	});

	it("seeds the picker from the named day you are overriding", () => {
		expect(
			dateOriginForPick({ kind: "relative", offset: -1, unit: "weeks" }),
		).toEqual({ kind: "ask", defaultValue: "last week" });
		expect(dateOriginForPick(undefined)).toEqual({ kind: "ask" });
		expect(
			dateOriginForPick({ kind: "ask", defaultValue: "last friday" }),
		).toEqual({ kind: "ask", defaultValue: "last friday" });
	});

	it("treats ask as a pick-date token", () => {
		expect(isPickDateToken("ask")).toBe(true);
		expect(isPickDateToken("ASK")).toBe(true);
		expect(isPickDateToken("last week")).toBe(false);
	});

	it("keeps the existing choice command id so hotkeys stay bound", () => {
		const id = "weekly-review-ask";
		expect(choiceCommandId(id)).toBe("choice:weekly-review-ask");
		expect(anotherDayCommandId(id)).toBe(
			"choice:weekly-review-ask:another-day",
		);
		expect(anotherDayCommandId(id)).not.toBe(choiceCommandId(id));
	});
});
