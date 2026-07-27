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

	it("does NOT apply |startof: snap to the preview (matches body preview)", async () => {
		const out = await makeFormatter().format(
			"{{VDATE:wk,gggg.MM.[Wk]w|startof:week}}",
		);
		// Snap is only resolved in the real CompleteFormatter pass; the preview
		// renders the current date (2023-06-01) like the body preview does, so
		// the two previews stay consistent. (DateFormatPreviewGenerator leaves
		// gggg / [Wk] literal — that's its existing simplified-preview behavior.)
		expect(out).toBe("gggg.06.[Wk]22");
	});

	it("ignores both the snap and the default hint", async () => {
		const formatter = makeFormatter();
		const out = await formatter.format(
			"{{VDATE:eom,YYYY-MM-DD|endof:month|tomorrow}}",
		);
		// No snap applied to the preview, no hint appended: the current date.
		// Note the token's own `|endof:month` carries a colon, and it is still
		// not reported - the check reads the finished NAME, not the format.
		expect(out).toBe("2023-06-01");
		expect(formatter.diagnostics.list()).toEqual([]);
	});

	it("leaves a snap-free VDATE preview unchanged (no spurious hints)", async () => {
		const out = await makeFormatter().format("{{VDATE:plain,YYYY-MM-DD}}");
		expect(out).toBe("2023-06-01");
	});

	it("returns the token literally when the format is missing", async () => {
		const out = await makeFormatter().format("{{VDATE:noformat}}");
		expect(out).toBe("{{VDATE:noformat}}");
	});
});
