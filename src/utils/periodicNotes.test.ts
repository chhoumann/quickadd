import moment from "moment";
import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { periodicNoteTemplateFor, replacePeriodicNoteTokens } from "./periodicNotes";

function appWith({
	dailyNotes,
	periodicNotes,
}: {
	dailyNotes?: { enabled: boolean; options: Record<string, string> };
	periodicNotes?: Record<string, Record<string, unknown>>;
}): App {
	return {
		internalPlugins: {
			plugins: dailyNotes
				? { "daily-notes": { enabled: dailyNotes.enabled, instance: { options: dailyNotes.options } } }
				: {},
		},
		plugins: {
			plugins: periodicNotes ? { "periodic-notes": { settings: periodicNotes } } : {},
		},
	} as unknown as App;
}

// Thursday June 1st 2023: the week starts in May (en locale, Sunday-first).
const june1 = moment("2023-06-01T15:00:00");

describe("periodic note tokens", () => {
	it("resolves {{DAILY}} from the Daily notes core plugin", () => {
		const app = appWith({
			dailyNotes: { enabled: true, options: { folder: "/Journal/", format: "YYYY/YYYY-MM-DD", template: "Templates/Daily" } },
		});

		expect(replacePeriodicNoteTokens("{{DAILY}}.md and [[{{daily}}]]", app, june1))
			.toBe("Journal/2023/2023-06-01.md and [[Journal/2023/2023-06-01]]");
	});

	it("uses the Daily notes defaults when the folder and format are blank", () => {
		const app = appWith({ dailyNotes: { enabled: true, options: {} } });

		expect(replacePeriodicNoteTokens("{{DAILY}}", app, june1)).toBe("2023-06-01");
	});

	it("files a week under the month it starts in, like Periodic Notes", () => {
		const app = appWith({
			periodicNotes: { weekly: { enabled: true, folder: "Weeks", format: "gggg.MM.[Wk]w" } },
		});

		expect(replacePeriodicNoteTokens("{{WEEKLY}}", app, june1)).toBe("Weeks/2023.05.Wk22");
	});

	it("prefers Periodic Notes over core Daily notes when it manages daily notes", () => {
		const app = appWith({
			dailyNotes: { enabled: true, options: { folder: "Core" } },
			periodicNotes: { daily: { enabled: true, folder: "Periodic", format: "DD.MM.YYYY" } },
		});

		expect(replacePeriodicNoteTokens("{{DAILY}}", app, june1)).toBe("Periodic/01.06.2023");
	});

	it("stops with a clear error when nothing manages the period", () => {
		const app = appWith({ dailyNotes: { enabled: false, options: {} } });

		expect(() => replacePeriodicNoteTokens("{{DAILY}}", app, june1)).toThrow(/Daily notes core plugin/);
		expect(() => replacePeriodicNoteTokens("{{MONTHLY}}", app, june1)).toThrow(/Periodic Notes plugin with monthly notes/);
	});

	it("finds the period's template only for that period's note", () => {
		const app = appWith({
			dailyNotes: { enabled: true, options: { folder: "Journal", template: "Templates/Daily" } },
		});

		expect(periodicNoteTemplateFor(app, "Journal/2023-06-01.md", june1)).toBe("Templates/Daily");
		expect(periodicNoteTemplateFor(app, "Journal/2023-05-31.md", june1)).toBeNull();
	});
});
