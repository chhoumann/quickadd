import realMoment from "moment";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import type { App } from "obsidian";

/**
 * The file-name VDATE preview: the formatted date, and nothing else.
 *
 * The audit-cleanup fix (bucket cu-filename-preview, task
 * format-core-format-preview) had this formatter mirror FormatDisplayFormatter
 * and append " (default: X)" / " (optional)" hints about the token. #1578
 * removed them again, for the same reason #1563 put the run's name normalizer
 * here: this row is a FILE NAME, the run splices in the formatted date and
 * nothing else, so a hint made the preview assert a name that could never be
 * created - and `(default: X)` put a colon, which Obsidian refuses outright,
 * into the middle of it.
 *
 * The hints survive where they are true: on the body preview
 * (FormatDisplayFormatter), and in the run's own prompt placeholder ("Enter
 * value for due (default: tomorrow)").
 *
 * Date rendering needs real moment + a frozen clock (the obsidian-stub moment
 * has no startOf/endOf), mirroring formatter-datesnap.test.ts. en locale =
 * Sunday-first week.
 */
const originalMoment = (window as unknown as { moment?: unknown }).moment;
const previousLocale = realMoment.locale();

beforeAll(() => {
	realMoment.locale("en");
	(window as unknown as { moment: unknown }).moment = realMoment;
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	realMoment.locale(previousLocale);
	vi.useRealTimers();
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2023-06-01T12:00:00")); // Thursday
});

// Minimal App: the VDATE preview path never touches the workspace/vault.
const mockApp = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [] },
	metadataCache: { getFileCache: () => null },
} as unknown as App;

function makeFormatter(): FileNameDisplayFormatter {
	return new FileNameDisplayFormatter(mockApp);
}

describe("FileNameDisplayFormatter VDATE preview", () => {
	it("shows the date alone, not the (default: X) hint (#1578)", async () => {
		const formatter = makeFormatter();
		const out = await formatter.format("{{VDATE:due,YYYY-MM-DD|tomorrow}}");
		expect(out).toBe("2023-06-01");
		// And therefore no colon, so the row does not accuse the author of a
		// character that only the preview ever wrote.
		expect(formatter.diagnostics.list()).toEqual([]);
	});

	it("shows the date alone, not the (optional) hint (#1578)", async () => {
		const out = await makeFormatter().format(
			"{{VDATE:due,YYYY-MM-DD|optional}}",
		);
		expect(out).toBe("2023-06-01");
	});

	it("shows the date alone when both options are present (#1578)", async () => {
		const out = await makeFormatter().format(
			"{{VDATE:due,YYYY-MM-DD|optional|tomorrow}}",
		);
		expect(out).toBe("2023-06-01");
	});

	it("applies |startof: snap to the example, as the run does", async () => {
		const out = await makeFormatter().format(
			"{{VDATE:wk,gggg.MM.[Wk]w|startof:week}}",
		);
		// The clock is Thursday 2023-06-01; start of week (en locale, Sunday
		// first) is 2023-05-28. #1595 left snap out here on the grounds that
		// snapping only this row would split it from the body row; both rows snap
		// now, and {{DATE:...|startof:}} in this same pass always did.
		// (DateFormatPreviewGenerator leaves gggg / [Wk] literal — that's its
		// existing simplified-preview behavior.)
		expect(out).toBe("gggg.05.[Wk]22");
	});

	it("applies |endof: snap and still appends no hint", async () => {
		const formatter = makeFormatter();
		const out = await formatter.format(
			"{{VDATE:eom,YYYY-MM-DD|endof:month|tomorrow}}",
		);
		// End of June. No hint appended: this row is a FILE NAME, and the run
		// splices in the date and nothing else. Note the token's own
		// `|endof:month` carries a colon and is still not reported - the check
		// reads the finished NAME, not the format.
		expect(out).toBe("2023-06-30");
		expect(formatter.diagnostics.list()).toEqual([]);
	});

	it("leaves a snap-free VDATE preview unchanged (no spurious hints)", async () => {
		const out = await makeFormatter().format("{{VDATE:plain,YYYY-MM-DD}}");
		expect(out).toBe("2023-06-01");
	});

	it("supplies the run's default format when the token names none (#1589)", async () => {
		// The run's own default (Formatter.replaceDateVariableInString), so a
		// working `{{VDATE:due}}` no longer previews as the raw token - and no
		// longer collects the colon inside that token as an illegal character.
		const formatter = makeFormatter();
		const out = await formatter.format("{{VDATE:noformat}}");
		expect(out).toBe("2023-06-01");
		expect(formatter.diagnostics.list()).toEqual([]);
	});

	it("uses the datetime default under |time, colon and all (#1589)", async () => {
		// YYYY-MM-DD HH:mm is what the run splices in, so the file-name preview
		// must show it - and then the #1578 diagnostic fires on its own, because
		// the finished NAME really does contain a colon Obsidian refuses.
		const formatter = makeFormatter();
		const out = await formatter.format("{{VDATE:due|time}}");
		expect(out).toMatch(/^2023-06-01 \d{2}:\d{2}$/);
		expect(formatter.diagnostics.list()).toEqual([
			{
				severity: "error",
				kind: "path",
				message:
					'A file or folder name cannot contain ":", so this choice would fail at run time. Check your own text and tokens like {{TIME}}, which is HH:mm.',
			},
		]);
	});

	it("still leaves a NAMELESS token literal, as the run does", async () => {
		const formatter = makeFormatter();
		const out = await formatter.format("{{VDATE:}}");
		expect(out).toBe("{{VDATE:}}");
	});

	it("renders an ANSWERED date instead of today (#1589/#1590)", async () => {
		// The one-page input form seeds the user's real picks into this formatter
		// before computing the preview; VDATE was the only seeded requirement type
		// the preview ignored.
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

	it("renders an answered-empty optional date as empty, not as today", async () => {
		const formatter = makeFormatter();
		(formatter as unknown as { variables: Map<string, unknown> }).variables.set(
			"due",
			"",
		);
		await expect(
			formatter.format("note {{VDATE:due,YYYY-MM-DD|optional}}"),
		).resolves.toBe("note");
	});

	it("does not blank the row for a half-typed |startof: unit", async () => {
		// "we" does not resolve (unlike "w", which is a real alias for week), so
		// normalizeDateUnit throws - and this runs on every keystroke (#1558). The
		// TEXT stays a date; the complaint goes on the diagnostics channel, which
		// the builder holds back until the field has been still for 500ms.
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

	it("says nothing for a SHORT unit that really is an alias", async () => {
		// "w" is week. Reporting it would be the cry-wolf this cluster deletes.
		const formatter = makeFormatter();
		await expect(
			formatter.format("{{VDATE:wk,YYYY-MM-DD|startof:w}}"),
		).resolves.toBe("2023-05-28");
		expect(formatter.diagnostics.list()).toEqual([]);
	});
});
