import moment from "moment";
import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import {
	dailyNoteLink,
	dailyNotePath,
	getDailyNoteSettings,
	readDailyNoteTemplate,
	renderDailyNoteTemplate,
	type DailyNoteSettings,
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

describe("getDailyNoteSettings", () => {
	it("reads the Daily notes core plugin, tidying the folder and template paths", () => {
		const app = appWith({ dailyNotes: core({ folder: "/Journal/2026//", format: " YYYY/MM-DD ", template: "\\Templates\\Daily" }) });

		expect(getDailyNoteSettings(app)).toEqual({
			source: "daily-notes", folder: "Journal/2026", format: "YYYY/MM-DD", template: "Templates/Daily",
		});
	});

	it("falls back to Obsidian's defaults for missing or wrongly typed settings", () => {
		expect(getDailyNoteSettings(appWith({ dailyNotes: core({ folder: 3, format: "", template: null }) })))
			.toEqual({ source: "daily-notes", folder: "", format: "YYYY-MM-DD", template: "" });
		expect(getDailyNoteSettings(appWith({ dailyNotes: { enabled: true } })))
			.toEqual({ source: "daily-notes", folder: "", format: "YYYY-MM-DD", template: "" });
	});

	it("uses Periodic Notes while it manages daily notes, and core Daily notes otherwise", () => {
		const dailyNotes = core({ folder: "Core" });
		expect(getDailyNoteSettings(appWith({ dailyNotes, periodicNotes: { daily: { enabled: true, folder: "Periodic", format: "DD.MM.YYYY" } } })))
			.toMatchObject({ source: "periodic-notes", folder: "Periodic", format: "DD.MM.YYYY" });
		expect(getDailyNoteSettings(appWith({ dailyNotes, periodicNotes: { daily: { enabled: false, folder: "Periodic" } } })))
			.toMatchObject({ source: "daily-notes", folder: "Core" });
		expect(getDailyNoteSettings(appWith({ dailyNotes, periodicNotes: "garbage" })))
			.toMatchObject({ source: "daily-notes", folder: "Core" });
	});

	it("stops when nothing manages daily notes, or Periodic Notes 1.0 might", () => {
		expect(() => getDailyNoteSettings(appWith({ dailyNotes: { enabled: false } }))).toThrow(/Daily notes core plugin/);
		expect(() => getDailyNoteSettings(undefined)).toThrow(/Daily notes core plugin/);
		expect(() => getDailyNoteSettings(appWith({ dailyNotes: core({}), periodicNotes: { calendarSets: [] } })))
			.toThrow(/Periodic Notes 1\.0/);
	});
});

describe("dailyNotePath", () => {
	const settings: DailyNoteSettings = { source: "daily-notes", folder: "Journal", format: "YYYY/YYYY-MM-DD", template: "" };

	it("formats the day into the daily notes folder", () => {
		expect(dailyNotePath(settings, day)).toBe("Journal/2026/2026-09-20");
		expect(dailyNotePath({ ...settings, folder: "" }, day)).toBe("2026/2026-09-20");
	});

	it("names the same note for any moment in the day, even with a time in the format", () => {
		const withTime = { ...settings, format: "YYYY-MM-DD HHmm" };
		expect(dailyNotePath(withTime, moment("2026-09-20T17:45:00"))).toBe(dailyNotePath(withTime, day));
	});

	it("leaves out an extension the format writes itself, as both plugins do", () => {
		// Core Daily notes creates `2031-03-04.md` for the format `YYYY-MM-DD[.md]` (Obsidian 1.13.7).
		expect(dailyNotePath({ ...settings, format: "YYYY-MM-DD[.md]" }, day)).toBe("Journal/2026-09-20");
	});

	it("refuses a format that gives an empty name", () => {
		expect(() => dailyNotePath({ ...settings, format: "[ ]" }, day)).toThrow(/empty file name/);
	});
});

describe("dailyNoteLink", () => {
	it("follows the vault's link settings for an existing note", () => {
		const app = appWith({ files: { "Journal/2026-09-20.md": "" } });
		expect(dailyNoteLink(app, "Journal/2026-09-20", "")).toBe("[[2026-09-20]]");
	});

	it("links a missing note by its full path, so following the link creates it in the right folder", () => {
		expect(dailyNoteLink(appWith({}), "Journal/2026 09/20", "")).toBe("[[Journal/2026 09/20]]");
		expect(dailyNoteLink(appWith({ linkFormat: "markdown" }), "Journal/2026 09/20", ""))
			.toBe("[20](Journal/2026%2009/20.md)");
		// `)` would end the destination. Obsidian 1.13.7 doesn't decode %23, so `#` is left as its own links leave it.
		expect(dailyNoteLink(appWith({ linkFormat: "markdown" }), "Journal)/2026 (x)", ""))
			.toBe("[2026 (x)](Journal%29/2026%20%28x%29.md)");
	});
});

describe("readDailyNoteTemplate", () => {
	const files = { "Templates/Daily.md": "core", "Templates/Deep/Periodic.md": "periodic", "Templates/Daily.v2.md": "dotted" };

	it("reads the Daily notes template by vault path, adding .md", async () => {
		const settings: DailyNoteSettings = { source: "daily-notes", folder: "", format: "YYYY-MM-DD", template: "Templates/Daily" };
		await expect(readDailyNoteTemplate(appWith({ files }), settings)).resolves.toBe("core");
		await expect(readDailyNoteTemplate(appWith({ files }), { ...settings, template: "Daily" })).rejects.toThrow(/"Daily" doesn't exist\. Fix it in Settings → Daily notes/);
		await expect(readDailyNoteTemplate(appWith({ files }), { ...settings, template: "" })).resolves.toBeNull();
		await expect(readDailyNoteTemplate(appWith({ files }), { ...settings, template: "Templates/Daily.md" })).resolves.toBe("core");
		// A dot in the name is not an extension.
		await expect(readDailyNoteTemplate(appWith({ files }), { ...settings, template: "Templates/Daily.v2" })).resolves.toBe("dotted");
	});

	it("resolves the Periodic Notes template as a link, like Periodic Notes does", async () => {
		const settings: DailyNoteSettings = { source: "periodic-notes", folder: "", format: "YYYY-MM-DD", template: "Periodic" };
		await expect(readDailyNoteTemplate(appWith({ files }), settings)).resolves.toBe("periodic");
	});
});

describe("renderDailyNoteTemplate", () => {
	const template = [
		"date={{date}}", "date:fmt={{date:YYYY [wk]ww}}", "time={{time}}", "time:fmt={{time:HH-mm}}",
		"title={{title}}", "yesterday={{yesterday}}", "tomorrow={{tomorrow}}", "dplus={{date+1d:YYYY-MM-DD}}",
		"spaced={{ date }}", "upper={{DATE}}", "titlefmt={{title:YYYY}}", "VALUE={{VALUE}}",
	].join("|");

	it("fills core Daily notes placeholders exactly as Obsidian 1.13.7 does", () => {
		const settings: DailyNoteSettings = { source: "daily-notes", folder: "", format: "YYYY-MM-DD", template: "" };

		// Recorded from app.internalPlugins.getPluginById("daily-notes").instance.getDailyNote(moment("2026-09-20")).
		expect(renderDailyNoteTemplate(template, settings, day, now)).toBe([
			"date=2026-09-30", "date:fmt=2026 wk40", "time=08:16", "time:fmt=08-16",
			"title=2026-09-20", "yesterday={{yesterday}}", "tomorrow={{tomorrow}}", "dplus={{date+1d:YYYY-MM-DD}}",
			"spaced={{ date }}", "upper=2026-09-30", "titlefmt={{title:YYYY}}", "VALUE={{VALUE}}",
		].join("|"));
		expect(renderDailyNoteTemplate("{{date:}} {{time:}}", settings, day, now)).toBe("2026-09-30 08:16");
	});

	it("fills Periodic Notes placeholders with the note's day, as obsidian-daily-notes-interface does", () => {
		const settings: DailyNoteSettings = { source: "periodic-notes", folder: "", format: "YYYY-MM-DD", template: "" };

		expect(renderDailyNoteTemplate(template, settings, day, now)).toBe([
			"date=2026-09-20", "date:fmt=2026 wk39", "time=08:16", "time:fmt=08-16",
			"title=2026-09-20", "yesterday=2026-09-19", "tomorrow=2026-09-21", "dplus=2026-09-21",
			"spaced=2026-09-20", "upper=2026-09-20", "titlefmt={{title:YYYY}}", "VALUE={{VALUE}}",
		].join("|"));
	});
});
