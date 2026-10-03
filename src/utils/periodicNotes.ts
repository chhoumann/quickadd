import { TFile, type App } from "obsidian";
import type { Moment, unitOfTime } from "moment";
import { usesMarkdownLinks } from "./fileLinks";

export const PERIODS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type Period = (typeof PERIODS)[number];

/**
 * `{{DAILY}}`, `{{WEEKLY}}`, `{{MONTHLY}}`, `{{QUARTERLY}}` and `{{YEARLY}}` are
 * the vault path, without extension, of that period's note for the run's day.
 * `|link` makes it a link to the note.
 */
export const PERIODIC_NOTE_REGEX = /{{(DAILY|WEEKLY|MONTHLY|QUARTERLY|YEARLY)(\|link)?}}/i;

export interface PeriodicNoteSettings {
	/** The plugin that owns the period's notes. The two fill templates differently. */
	source: "daily-notes" | "periodic-notes";
	folder: string;
	format: string;
	template: string;
}

// The defaults Daily notes and Periodic Notes use for a blank format.
const DEFAULT_FORMATS: Record<Period, string> = {
	daily: "YYYY-MM-DD",
	weekly: "gggg-[W]ww",
	monthly: "YYYY-MM",
	quarterly: "YYYY-[Q]Q",
	yearly: "YYYY",
};

const PERIOD_UNITS: Record<Period, unitOfTime.StartOf> = {
	daily: "day",
	weekly: "week",
	monthly: "month",
	quarterly: "quarter",
	yearly: "year",
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function vaultPath(path: string): string {
	return path.replace(/[\\/]+/g, "/").replace(/^\/|\/$/g, "");
}

function token(period: Period): string {
	return `{{${period.toUpperCase()}}}`;
}

function settingsFrom(source: PeriodicNoteSettings["source"], period: Period, raw: Record<string, unknown>): PeriodicNoteSettings {
	return {
		source,
		folder: vaultPath(text(raw.folder)),
		format: text(raw.format) || DEFAULT_FORMATS[period],
		template: vaultPath(text(raw.template)),
	};
}

/**
 * Where the vault keeps the period's notes. Periodic Notes wins for a period it
 * manages, as it does in Obsidian; daily notes otherwise come from the Daily
 * notes core plugin. The settings are other plugins' internals, so every field
 * is checked before use.
 */
export function getPeriodicNoteSettings(app: App | undefined, period: Period): PeriodicNoteSettings {
	const periodicNotes = record(record(app?.plugins?.plugins?.["periodic-notes"])?.settings);
	// Periodic Notes 1.0 (beta) keeps its settings in calendar sets. Reading only
	// core Daily notes there could target a different note than the one it opens.
	if (periodicNotes && "calendarSets" in periodicNotes) {
		throw new Error(`${token(period)} can't read the settings of Periodic Notes 1.0. Use Periodic Notes 0.0.17, or turn it off and use the Daily notes core plugin.`);
	}
	const managed = record(periodicNotes?.[period]);
	if (managed?.enabled === true) return settingsFrom("periodic-notes", period, managed);

	if (period !== "daily") {
		throw new Error(`${token(period)} needs the Periodic Notes plugin with ${period} notes turned on.`);
	}
	const dailyNotes = record(app?.internalPlugins?.plugins?.["daily-notes"]);
	if (dailyNotes?.enabled === true) {
		return settingsFrom("daily-notes", period, record(record(dailyNotes.instance)?.options) ?? {});
	}
	throw new Error("{{DAILY}} needs the Daily notes core plugin, or Periodic Notes with daily notes, turned on.");
}

/** The first moment of the period `date` falls in, which names the period's note. */
export function periodStart(period: Period, date: Moment): Moment {
	return date.clone().startOf(PERIOD_UNITS[period]);
}

/**
 * The note's vault path, without extension, for the period containing `date`.
 * Named from the period's start, as Periodic Notes names it, so a week that
 * starts in May files under May.
 */
export function periodicNotePath(settings: PeriodicNoteSettings, period: Period, date: Moment): string {
	// Both plugins store `x.md` for a format ending in `[.md]`, so the extension
	// is not part of the path.
	const name = periodStart(period, date).format(settings.format).trim().replace(/\.md$/i, "");
	if (!name) throw new Error(`The ${period} note format "${settings.format}" gives an empty file name.`);
	return settings.folder ? `${settings.folder}/${name}` : name;
}

/**
 * A link that follows the vault's link settings when the note exists. A missing
 * note gets its full path, so following the link creates it in the period's
 * folder rather than in the default location for new notes.
 */
export function periodicNoteLink(app: App, path: string, sourcePath: string): string {
	const file = app.vault.getAbstractFileByPath(`${path}.md`);
	if (file instanceof TFile) return app.fileManager.generateMarkdownLink(file, sourcePath);
	if (!usesMarkdownLinks(app)) return `[[${path}]]`;
	// Encoded like Obsidian's own links, plus parentheses, which would end the
	// destination. Obsidian doesn't decode %23, so a `#` stays as Obsidian writes it.
	const destination = encodeURI(`${path}.md`).replace(/\(/g, "%28").replace(/\)/g, "%29");
	// Escaped like a Markdown link alias (fileLinks.ts), so `[`, `]` and `\` stay in the label.
	const label = (path.split("/").pop() ?? path).replace(/[\\[\]]/g, "\\$&");
	return `[${label}](${destination})`;
}

/**
 * The period's template contents, or null when none is set. The two plugins
 * look the template up differently: Daily notes by vault path (with or without
 * `.md`), Periodic Notes as a link. A template that is set but missing stops
 * the run.
 */
export async function readPeriodicNoteTemplate(app: App, settings: PeriodicNoteSettings, period: Period): Promise<string | null> {
	const { template } = settings;
	if (!template) return null;
	const exact = app.vault.getAbstractFileByPath(template);
	const file = settings.source === "periodic-notes"
		? app.metadataCache.getFirstLinkpathDest(template, "")
		: exact instanceof TFile ? exact : app.vault.getAbstractFileByPath(`${template}.md`);
	if (!(file instanceof TFile)) {
		const where = settings.source === "daily-notes" ? "Daily notes" : "Periodic Notes";
		throw new Error(`The ${period} note template "${template}" doesn't exist. Fix it in Settings → ${where}.`);
	}
	return app.vault.cachedRead(file);
}

/** Periodic Notes' `{{date}}`, `{{date:fmt}}` and `{{date+1d:fmt}}` family. */
function replaceDateTokens(content: string, start: Moment, now: Moment, format: string): string {
	return content.replace(
		/{{\s*(date|time)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
		(_match: string, _kind: string, calc?: string, delta?: string, unit?: string, custom?: string) => {
			const moment = start.clone().set({ hour: now.hour(), minute: now.minute(), second: now.second() });
			if (calc && delta && unit) moment.add(parseInt(delta, 10), unit as "d");
			return custom ? moment.format(custom.substring(1).trim()) : moment.format(format);
		},
	);
}

/**
 * Fills a period's template with the placeholders of the plugin that owns it,
 * so QuickAdd creates the note Obsidian would. QuickAdd's own format syntax is
 * not applied, since the template is written for that plugin.
 *
 * - Daily notes: `{{date}}` and `{{time}}` are the moment the note is created,
 *   optionally `{{date:<format>}}`; `{{title}}` is the file name. Names are
 *   case-insensitive and allow no spaces inside the braces.
 * - Periodic Notes 0.0.17 renders through obsidian-daily-notes-interface, whose
 *   replacements differ per period, in content and in order (the order decides
 *   what a bare `{{time}}` becomes). Ported as-is:
 *   - daily: `{{date}}`/`{{title}}` are the file name, `{{time}}` is now,
 *     `{{date:fmt}}`/`{{date+1d:fmt}}` are the note's day, and
 *     `{{yesterday}}`/`{{tomorrow}}` the neighbours' names.
 *   - weekly: the `{{date...}}` family from the week's start, `{{title}}`,
 *     `{{time}}`, and `{{sunday:fmt}}` … `{{saturday:fmt}}` for that day of the week.
 *   - monthly, quarterly, yearly: the `{{date...}}` family from the period's
 *     start, then `{{date}}`, `{{time}}` and `{{title}}`.
 *
 * `date` is any moment in the period; `now` is when the note is created.
 */
export function renderPeriodicNoteTemplate(
	content: string,
	settings: PeriodicNoteSettings,
	period: Period,
	date: Moment,
	now: Moment,
): string {
	const { format } = settings;
	const start = periodStart(period, date);
	if (settings.source === "daily-notes") {
		const title = start.format(format).trim();
		return content.replace(/{{(date|time|title)(?::([^}]*))?}}/gi, (match: string, name: string, custom?: string) => {
			const kind = name.toLowerCase();
			if (kind === "title") return custom === undefined ? title : match;
			return now.format(custom || (kind === "date" ? "YYYY-MM-DD" : "HH:mm"));
		});
	}

	const filename = start.format(format);
	const time = now.format("HH:mm");
	if (period === "daily") {
		return replaceDateTokens(
			content
				.replace(/{{\s*date\s*}}/gi, filename)
				.replace(/{{\s*time\s*}}/gi, time)
				.replace(/{{\s*title\s*}}/gi, filename),
			start, now, format,
		)
			.replace(/{{\s*yesterday\s*}}/gi, start.clone().subtract(1, "day").format(format))
			.replace(/{{\s*tomorrow\s*}}/gi, start.clone().add(1, "d").format(format));
	}
	if (period === "weekly") {
		// Day names map to positions in the locale's week, like Periodic Notes.
		const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
		const firstDay = start.localeData().firstDayOfWeek();
		const localeDays = [...days.slice(firstDay), ...days.slice(0, firstDay)];
		return replaceDateTokens(content, start, now, format)
			.replace(/{{\s*title\s*}}/gi, filename)
			.replace(/{{\s*time\s*}}/gi, time)
			.replace(
				/{{\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*:(.*?)}}/gi,
				(_match: string, day: string, dayFormat: string) =>
					start.clone().weekday(localeDays.indexOf(day.toLowerCase())).format(dayFormat.trim()),
			);
	}
	return replaceDateTokens(content, start, now, format)
		.replace(/{{\s*date\s*}}/gi, filename)
		.replace(/{{\s*time\s*}}/gi, time)
		.replace(/{{\s*title\s*}}/gi, filename);
}
