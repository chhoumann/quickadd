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
			"@date:2026-08-15T00:00:00.000Z",
		);
		await expect(formatter.format("{{VDATE:due}}")).resolves.toBe("2026-08-15");
	});

	it("does not blank the row for a half-typed |startof: unit", async () => {
		// parseVDateOptions throws on an unfinished unit, and every prefix of
		// "week" is one. Before this the whole body preview went blank and red
		// between two keystrokes (#1558's failure mode).
		const formatter = makeFormatter();
		await expect(
			formatter.format("{{VDATE:wk,YYYY-MM-DD|startof:w}}"),
		).resolves.toBe("2023-06-01");
		expect(formatter.diagnostics.list()).toEqual([]);
	});
});
