import realMoment from "moment";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import type { App } from "obsidian";

/**
 * Regression for the audit-cleanup fix (bucket cu-filename-preview, task
 * format-core-format-preview): FileNameDisplayFormatter.replaceDateVariableInString
 * used to stop at (match, variableName, dateFormat) and ignore the third capture
 * group, so the file-name VDATE preview dropped the "(default: X)" / "(optional)"
 * hints and the |startof:/|endof: period-snap that FormatDisplayFormatter's body
 * preview shows. It now mirrors that behaviour.
 *
 * Snap rendering needs real moment + a frozen clock (the obsidian-stub moment has
 * no startOf/endOf), mirroring formatter-datesnap.test.ts. en locale =
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

describe("FileNameDisplayFormatter VDATE preview (audit-cleanup)", () => {
	it("appends the (default: X) hint", async () => {
		const out = await makeFormatter().format(
			"{{VDATE:due,YYYY-MM-DD|tomorrow}}",
		);
		expect(out).toBe("2023-06-01 (default: tomorrow)");
	});

	it("appends the (optional) hint", async () => {
		const out = await makeFormatter().format(
			"{{VDATE:due,YYYY-MM-DD|optional}}",
		);
		expect(out).toBe("2023-06-01 (optional)");
	});

	it("appends both hints together (default + optional, order-insensitive)", async () => {
		const out = await makeFormatter().format(
			"{{VDATE:due,YYYY-MM-DD|optional|tomorrow}}",
		);
		expect(out).toBe("2023-06-01 (default: tomorrow) (optional)");
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

	it("ignores snap but still appends a default hint", async () => {
		const out = await makeFormatter().format(
			"{{VDATE:eom,YYYY-MM-DD|endof:month|tomorrow}}",
		);
		// No snap applied to the preview; current date + default hint.
		expect(out).toBe("2023-06-01 (default: tomorrow)");
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
