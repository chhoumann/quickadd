import realMoment from "moment";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import type QuickAdd from "../main";

/**
 * The BODY preview's {{VDATE:}} behaviour, the sibling of
 * `fileNameDisplayFormatter.audit-cleanup.test.ts`.
 *
 * The two previews are kept deliberately in step: a format string that is legal
 * in both fields must render the same way in both, or the builder contradicts
 * itself depending on which row you look at.
 */

const app = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
} as unknown as App;

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

function makeFormatter() {
	return new FormatDisplayFormatter(app, plugin);
}

// Rendering a stored @date:ISO needs real moment (the obsidian-stub's returns a
// fixed date), plus a frozen clock for the example-date branch. Mirrors
// fileNameDisplayFormatter.audit-cleanup.test.ts.
const originalMoment = (window as unknown as { moment?: unknown }).moment;

beforeAll(() => {
	(window as unknown as { moment: unknown }).moment = realMoment;
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	vi.useRealTimers();
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2023-06-01T10:30:00"));
});

describe("FormatDisplayFormatter VDATE default format (#1589)", () => {
	it("supplies YYYY-MM-DD when the token names no format", async () => {
		const formatter = makeFormatter();
		await expect(formatter.format("{{VDATE:due}}")).resolves.toBe("2023-06-01");
		expect(formatter.diagnostics.list()).toEqual([]);
	});

	it("supplies the datetime default under |time", async () => {
		await expect(makeFormatter().format("{{VDATE:due|time}}")).resolves.toMatch(
			/^2023-06-01 \d{2}:\d{2}$/,
		);
	});

	it("keeps the (default: X) hint the body preview is entitled to", async () => {
		// The hints live here and NOT on the file-name row: the run's prompt
		// really does say "(default: tomorrow)", but it splices only the date into
		// a file name (#1578).
		await expect(
			makeFormatter().format("{{VDATE:due|tomorrow}}"),
		).resolves.toBe("2023-06-01 (default: tomorrow)");
	});

	it("still leaves a NAMELESS token literal, as the run does", async () => {
		await expect(makeFormatter().format("{{VDATE:}}")).resolves.toBe(
			"{{VDATE:}}",
		);
	});

	it("renders an ANSWERED date instead of today", async () => {
		const formatter = makeFormatter();
		(formatter as unknown as { variables: Map<string, unknown> }).variables.set(
			"due",
			// Built from a LOCAL date, not a "Z" literal: the stored value is an
			// instant and moment formats it in local time, so a midnight-UTC
			// literal renders as the 14th anywhere west of UTC (this test file's
			// sibling carries the same warning).
			`@date:${new Date(2026, 7, 15, 12, 0, 0).toISOString()}`,
		);
		await expect(formatter.format("{{VDATE:due}}")).resolves.toBe("2026-08-15");
	});

	it("keeps the text stable for a half-typed |startof: unit, and still reports it", async () => {
		// parseVDateOptions throws on a unit that does not resolve. Before, that
		// blanked the whole body preview between two keystrokes (#1558's failure
		// mode); swallowing it outright would have deleted a diagnostic this
		// preview already shipped. The text stays a date, the complaint goes on
		// the channel the builder holds back until the field is idle.
		const formatter = makeFormatter();
		await expect(
			formatter.format("{{VDATE:wk,YYYY-MM-DD|startof:we}}"),
		).resolves.toBe("2023-06-01");
		expect(formatter.diagnostics.list()).toEqual([
			{
				severity: "error",
				message: expect.stringContaining('Unknown date unit "we"') as never,
			},
		]);
	});

	it("applies a valid snap to the example, matching {{DATE:...|startof:}}", async () => {
		await expect(
			makeFormatter().format("{{VDATE:wk,YYYY-MM-DD|startof:month}}"),
		).resolves.toBe("2023-06-01");
	});

	it("applies case transforms to the same VDATE preview shown in the builder", async () => {
		await expect(
			makeFormatter().format("{{VDATE:due,dddd, MMMM Do|case:lower}}"),
		).resolves.toBe("thursday, june 1st");
	});
});
