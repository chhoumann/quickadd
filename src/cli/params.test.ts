import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { resolveCurrentNote } from "./params";

function file(path: string): TFile {
	return Object.assign(new TFile(), { path });
}

describe("resolveCurrentNote", () => {
	const report = file("Report.pdf");
	const reportNote = file("Report.pdf.md");
	const today = file("Daily/Today.md");
	const files = new Map([report, reportNote, today].map((entry) => [entry.path, entry]));
	const app = { vault: { getFileByPath: (path: string) => files.get(path) ?? null } } as unknown as App;

	it("takes the file at the exact path before trying the .md suffix", () => {
		expect(resolveCurrentNote(app, { current: "Report.pdf" })).toBe(report);
		expect(resolveCurrentNote(app, { current: "Report.pdf.md" })).toBe(reportNote);
		expect(resolveCurrentNote(app, { current: "Daily/Today" })).toBe(today);
		expect(resolveCurrentNote(app, { current: " /Daily/Today.md " })).toBe(today);
	});

	it("is null for none, undefined when absent, and fails on an unknown path", () => {
		expect(resolveCurrentNote(app, { current: "none" })).toBeNull();
		expect(resolveCurrentNote(app, {})).toBeUndefined();
		expect(() => resolveCurrentNote(app, { current: "Nope" })).toThrow("No note at 'Nope'.");
	});
});
