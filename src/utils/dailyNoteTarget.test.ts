import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { resolveDailyNoteTarget } from "./dailyNoteTarget";

function appWith({
	core,
	periodic,
}: {
	core?: Record<string, unknown>;
	periodic?: Record<string, unknown>;
}): App {
	return {
		internalPlugins: {
			plugins: { "daily-notes": { instance: { options: core } } },
		},
		plugins: {
			plugins: periodic ? { "periodic-notes": { settings: { daily: periodic } } } : {},
		},
	} as unknown as App;
}

function dailyCapture() {
	const choice = new CaptureChoice("Log");
	choice.captureToDailyNote = true;
	return choice;
}

describe("resolveDailyNoteTarget", () => {
	it("captures into the Daily notes path and creates it from the Daily notes template", () => {
		const app = appWith({
			core: { folder: "Journal/Daily", format: "YYYY/MM/YYYY-MM-DD", template: "Templates/Daily" },
		});

		const resolved = resolveDailyNoteTarget(app, dailyCapture());

		expect(resolved.captureTo).toBe("Journal/Daily/{{DATE:YYYY/MM/YYYY-MM-DD}}.md");
		expect(resolved.createFileIfItDoesntExist).toEqual({
			enabled: true,
			createWithTemplate: true,
			template: "Templates/Daily.md",
		});
	});

	it("falls back to Obsidian's defaults when Daily notes has no settings", () => {
		const resolved = resolveDailyNoteTarget(appWith({}), dailyCapture());

		expect(resolved.captureTo).toBe("{{DATE:YYYY-MM-DD}}.md");
		expect(resolved.createFileIfItDoesntExist).toEqual({
			enabled: true,
			createWithTemplate: false,
			template: "",
		});
	});

	it("follows Periodic Notes only while its daily notes are turned on", () => {
		const core = { folder: "Daily", format: "YYYY-MM-DD" };
		const periodic = { folder: "Periodic/Daily", format: "DD-MM-YYYY", template: "T/Day.md" };

		expect(
			resolveDailyNoteTarget(appWith({ core, periodic: { ...periodic, enabled: true } }), dailyCapture())
				.captureTo,
		).toBe("Periodic/Daily/{{DATE:DD-MM-YYYY}}.md");
		expect(
			resolveDailyNoteTarget(appWith({ core, periodic: { ...periodic, enabled: false } }), dailyCapture())
				.captureTo,
		).toBe("Daily/{{DATE:YYYY-MM-DD}}.md");
	});

	it("leaves other captures untouched", () => {
		const choice = new CaptureChoice("Inbox");
		choice.captureTo = "Inbox.md";

		expect(resolveDailyNoteTarget(appWith({ core: { folder: "Daily" } }), choice)).toBe(choice);
	});
});
