import moment from "moment";
import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import {
	getPeriodicNoteSettings,
	periodicNoteLink,
	periodicNotePath,
	readPeriodicNoteTemplate,
	renderPeriodicNoteTemplate,
	type PeriodicNoteSettings,
} from "./periodicNotes";

function file(path: string): TFile {
	const f = new TFile();
	f.path = path;
	return f;
}

function appWith({
	dailyNotes,
	periodicNotes,
	files = {},
	linkFormat,
}: {
	dailyNotes?: unknown;
	periodicNotes?: unknown;
	files?: Record<string, string>;
	linkFormat?: "markdown";
}): App {
	return {
		internalPlugins: { plugins: dailyNotes === undefined ? {} : { "daily-notes": dailyNotes } },
		plugins: { plugins: periodicNotes === undefined ? {} : { "periodic-notes": { settings: periodicNotes } } },
		vault: {
			getAbstractFileByPath: (path: string) => (path in files ? file(path) : null),
			cachedRead: async (f: TFile) => files[f.path],
			getConfig: (key: string) => (key === "useMarkdownLinks" ? linkFormat === "markdown" : undefined),
		},
		metadataCache: {
			getFirstLinkpathDest: (linkpath: string) => {
				const match = Object.keys(files).find((path) => path === linkpath || path === `${linkpath}.md` || path.endsWith(`/${linkpath}.md`));
				return match ? file(match) : null;
			},
		},
		fileManager: {
			generateMarkdownLink: (f: TFile) => `[[${f.path.replace(/\.md$/, "").split("/").pop()}]]`,
		},
	} as unknown as App;
}

const core = (options: unknown) => ({ enabled: true, instance: { options } });
const day = moment("2026-09-20T00:00:00");
const now = moment("2026-09-30T08:16:00");

describe("getPeriodicNoteSettings", () => {
	it("reads the Daily notes core plugin, tidying the folder and template paths", () => {
		const app = appWith({ dailyNotes: core({ folder: "/Journal/2026//", format: " YYYY/MM-DD ", template: "\\Templates\\Daily" }) });

		expect(getPeriodicNoteSettings(app, "daily")).toEqual({
			source: "daily-notes", folder: "Journal/2026", format: "YYYY/MM-DD", template: "Templates/Daily",
		});
	});

	it("falls back to Obsidian's defaults for missing or wrongly typed settings", () => {
		expect(getPeriodicNoteSettings(appWith({ dailyNotes: core({ folder: 3, format: "", template: null }) }), "daily"))
			.toEqual({ source: "daily-notes", folder: "", format: "YYYY-MM-DD", template: "" });
		expect(getPeriodicNoteSettings(appWith({ dailyNotes: { enabled: true } }), "daily"))
			.toEqual({ source: "daily-notes", folder: "", format: "YYYY-MM-DD", template: "" });
	});

	it("uses Periodic Notes while it manages daily notes, and core Daily notes otherwise", () => {
		const dailyNotes = core({ folder: "Core" });
		expect(getPeriodicNoteSettings(appWith({ dailyNotes, periodicNotes: { daily: { enabled: true, folder: "Periodic", format: "DD.MM.YYYY" } } }), "daily"))
			.toMatchObject({ source: "periodic-notes", folder: "Periodic", format: "DD.MM.YYYY" });
		expect(getPeriodicNoteSettings(appWith({ dailyNotes, periodicNotes: { daily: { enabled: false, folder: "Periodic" } } }), "daily"))
			.toMatchObject({ source: "daily-notes", folder: "Core" });
		expect(getPeriodicNoteSettings(appWith({ dailyNotes, periodicNotes: "garbage" }), "daily"))
			.toMatchObject({ source: "daily-notes", folder: "Core" });
	});

	it("stops when nothing manages daily notes, or Periodic Notes 1.0 might", () => {
		expect(() => getPeriodicNoteSettings(appWith({ dailyNotes: { enabled: false } }), "daily")).toThrow(/Daily notes core plugin/);
		expect(() => getPeriodicNoteSettings(undefined, "daily")).toThrow(/Daily notes core plugin/);
		expect(() => getPeriodicNoteSettings(appWith({ dailyNotes: core({}), periodicNotes: { calendarSets: [] } }), "daily"))
			.toThrow(/Periodic Notes 1\.0/);
	});
});

describe("other periods", () => {
	it("reads weekly, monthly, quarterly and yearly notes only from Periodic Notes, with its defaults", () => {
		const app = appWith({
			dailyNotes: core({}),
			periodicNotes: { weekly: { enabled: true, folder: "Weeks", format: "" }, monthly: { enabled: false } },
		});

		expect(getPeriodicNoteSettings(app, "weekly")).toEqual({ source: "periodic-notes", folder: "Weeks", format: "gggg-[W]ww", template: "" });
		expect(() => getPeriodicNoteSettings(app, "monthly")).toThrow("{{MONTHLY}} needs the Periodic Notes plugin with monthly notes turned on.");
		expect(() => getPeriodicNoteSettings(appWith({ dailyNotes: core({}) }), "yearly")).toThrow(/{{YEARLY}} needs the Periodic Notes plugin/);
	});

	it("names each note from the start of its period, like Periodic Notes", () => {
		const settings = (format: string): PeriodicNoteSettings => ({ source: "periodic-notes", folder: "P", format, template: "" });
		// Thursday 1 June 2023: its week (en, Sunday-first) starts in May.
		const june1 = moment("2023-06-01T15:00:00");

		expect(periodicNotePath(settings("gggg.MM.[Wk]w"), "weekly", june1)).toBe("P/2023.05.Wk22");
		expect(periodicNotePath(settings("YYYY-MM-DD"), "monthly", june1)).toBe("P/2023-06-01");
		expect(periodicNotePath(settings("YYYY-MM-DD"), "quarterly", june1)).toBe("P/2023-04-01");
		expect(periodicNotePath(settings("YYYY-MM-DD"), "yearly", june1)).toBe("P/2023-01-01");
	});

	it("fills weekly templates as Periodic Notes 0.0.17 does, day names included", () => {
		const settings: PeriodicNoteSettings = { source: "periodic-notes", folder: "", format: "gggg-[W]ww", template: "" };
		const thursday = moment("2026-09-24T00:00:00");

		expect(renderPeriodicNoteTemplate(
			"{{title}}|{{date}}|{{date:YYYY-MM-DD}}|{{date+1w:YYYY-MM-DD}}|{{monday:ddd D}}|{{ Saturday : MMM D }}|{{time}}|{{yesterday}}",
			settings, "weekly", thursday, now,
		// A bare {{time}} is taken by the {{date...}} pass first, so it is the week's name, as in Periodic Notes.
		)).toBe("2026-W39|2026-W39|2026-09-20|2026-09-27|Mon 21|Sep 26|2026-W39|{{yesterday}}");
	});

	it("fills monthly, quarterly and yearly templates from the period's start", () => {
		const settings = (format: string): PeriodicNoteSettings => ({ source: "periodic-notes", folder: "", format, template: "" });
		const template = "{{title}}|{{date:YYYY-MM-DD}}|{{date-1M:MMMM}}|{{monday:D}}";

		expect(renderPeriodicNoteTemplate(template, settings("YYYY-MM"), "monthly", day, now)).toBe("2026-09|2026-09-01|August|{{monday:D}}");
		expect(renderPeriodicNoteTemplate(template, settings("YYYY-[Q]Q"), "quarterly", day, now)).toBe("2026-Q3|2026-07-01|June|{{monday:D}}");
		expect(renderPeriodicNoteTemplate(template, settings("YYYY"), "yearly", day, now)).toBe("2026|2026-01-01|December|{{monday:D}}");
	});
});

describe("periodicNotePath", () => {
	const settings: PeriodicNoteSettings = { source: "daily-notes", folder: "Journal", format: "YYYY/YYYY-MM-DD", template: "" };

	it("formats the day into the daily notes folder", () => {
		expect(periodicNotePath(settings, "daily", day)).toBe("Journal/2026/2026-09-20");
		expect(periodicNotePath({ ...settings, folder: "" }, "daily", day)).toBe("2026/2026-09-20");
	});

	it("names the same note for any moment in the day, even with a time in the format", () => {
		const withTime = { ...settings, format: "YYYY-MM-DD HHmm" };
		expect(periodicNotePath(withTime, "daily", moment("2026-09-20T17:45:00"))).toBe(periodicNotePath(withTime, "daily", day));
	});

	it("leaves out an extension the format writes itself, as both plugins do", () => {
		// Core Daily notes creates `2031-03-04.md` for the format `YYYY-MM-DD[.md]` (Obsidian 1.13.7).
		expect(periodicNotePath({ ...settings, format: "YYYY-MM-DD[.md]" }, "daily", day)).toBe("Journal/2026-09-20");
		expect(periodicNotePath({ ...settings, format: "gggg-[W]ww[.md]" }, "weekly", day)).toBe("Journal/2026-W39");
	});

	it("refuses a format that gives an empty name", () => {
		expect(() => periodicNotePath({ ...settings, format: "[ ]" }, "daily", day)).toThrow(/empty file name/);
	});
});

describe("periodicNoteLink", () => {
	it("follows the vault's link settings for an existing note", () => {
		const app = appWith({ files: { "Journal/2026-09-20.md": "" } });
		expect(periodicNoteLink(app, "Journal/2026-09-20", "")).toBe("[[2026-09-20]]");
	});

	it("links a missing note by its full path, so following the link creates it in the right folder", () => {
		expect(periodicNoteLink(appWith({}), "Journal/2026 09/20", "")).toBe("[[Journal/2026 09/20]]");
		expect(periodicNoteLink(appWith({ linkFormat: "markdown" }), "Journal/2026 09/20", ""))
			.toBe("[20](Journal/2026%2009/20.md)");
		// `)` would end the destination. Obsidian 1.13.7 doesn't decode %23, so `#` is left as its own links leave it.
		expect(periodicNoteLink(appWith({ linkFormat: "markdown" }), "Journal)/2026 (x)", ""))
			.toBe("[2026 (x)](Journal%29/2026%20%28x%29.md)");
		expect(periodicNoteLink(appWith({ linkFormat: "markdown" }), "Journal/2026]W1[\\", ""))
			.toBe("[2026\\]W1\\[\\\\](Journal/2026%5DW1%5B%5C.md)");
	});
});

describe("readPeriodicNoteTemplate", () => {
	const files = { "Templates/Daily.md": "core", "Templates/Deep/Periodic.md": "periodic", "Templates/Daily.v2.md": "dotted" };

	it("reads the Daily notes template by vault path, adding .md", async () => {
		const settings: PeriodicNoteSettings = { source: "daily-notes", folder: "", format: "YYYY-MM-DD", template: "Templates/Daily" };
		await expect(readPeriodicNoteTemplate(appWith({ files }), settings, "daily")).resolves.toBe("core");
		await expect(readPeriodicNoteTemplate(appWith({ files }), { ...settings, template: "Daily" }, "daily")).rejects.toThrow(/daily note template "Daily" doesn't exist\. Fix it in Settings → Daily notes/);
		await expect(readPeriodicNoteTemplate(appWith({ files }), { ...settings, template: "" }, "daily")).resolves.toBeNull();
		await expect(readPeriodicNoteTemplate(appWith({ files }), { ...settings, template: "Templates/Daily.md" }, "daily")).resolves.toBe("core");
		// A dot in the name is not an extension.
		await expect(readPeriodicNoteTemplate(appWith({ files }), { ...settings, template: "Templates/Daily.v2" }, "daily")).resolves.toBe("dotted");
	});

	it("resolves the Periodic Notes template as a link, like Periodic Notes does", async () => {
		const settings: PeriodicNoteSettings = { source: "periodic-notes", folder: "", format: "YYYY-MM-DD", template: "Periodic" };
		await expect(readPeriodicNoteTemplate(appWith({ files }), settings, "daily")).resolves.toBe("periodic");
	});
});

describe("renderPeriodicNoteTemplate", () => {
	const template = [
		"date={{date}}", "date:fmt={{date:YYYY [wk]ww}}", "time={{time}}", "time:fmt={{time:HH-mm}}",
		"title={{title}}", "yesterday={{yesterday}}", "tomorrow={{tomorrow}}", "dplus={{date+1d:YYYY-MM-DD}}",
		"spaced={{ date }}", "upper={{DATE}}", "titlefmt={{title:YYYY}}", "VALUE={{VALUE}}",
	].join("|");

	it("fills core Daily notes placeholders exactly as Obsidian 1.13.7 does", () => {
		const settings: PeriodicNoteSettings = { source: "daily-notes", folder: "", format: "YYYY-MM-DD", template: "" };

		// Recorded from app.internalPlugins.getPluginById("daily-notes").instance.getDailyNote(moment("2026-09-20")).
		expect(renderPeriodicNoteTemplate(template, settings, "daily", day, now)).toBe([
			"date=2026-09-30", "date:fmt=2026 wk40", "time=08:16", "time:fmt=08-16",
			"title=2026-09-20", "yesterday={{yesterday}}", "tomorrow={{tomorrow}}", "dplus={{date+1d:YYYY-MM-DD}}",
			"spaced={{ date }}", "upper=2026-09-30", "titlefmt={{title:YYYY}}", "VALUE={{VALUE}}",
		].join("|"));
		expect(renderPeriodicNoteTemplate("{{date:}} {{time:}}", settings, "daily", day, now)).toBe("2026-09-30 08:16");
	});

	it("fills Periodic Notes placeholders with the note's day, as obsidian-daily-notes-interface does", () => {
		const settings: PeriodicNoteSettings = { source: "periodic-notes", folder: "", format: "YYYY-MM-DD", template: "" };

		expect(renderPeriodicNoteTemplate(template, settings, "daily", day, now)).toBe([
			"date=2026-09-20", "date:fmt=2026 wk39", "time=08:16", "time:fmt=08-16",
			"title=2026-09-20", "yesterday=2026-09-19", "tomorrow=2026-09-21", "dplus=2026-09-21",
			"spaced=2026-09-20", "upper=2026-09-20", "titlefmt={{title:YYYY}}", "VALUE={{VALUE}}",
		].join("|"));
	});
});
