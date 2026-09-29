import type { App } from "obsidian";
import type { Moment, unitOfTime } from "moment";

export const PERIODS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type Period = (typeof PERIODS)[number];

// {{DAILY}}, {{WEEKLY}}, {{MONTHLY}}, {{QUARTERLY}}, {{YEARLY}}: the vault path
// (without extension) of that period's note for the run's day.
export const PERIODIC_NOTE_REGEX = /{{(DAILY|WEEKLY|MONTHLY|QUARTERLY|YEARLY)}}/i;

export interface PeriodicNoteSettings {
	folder: string;
	format: string;
	template: string;
}

// The defaults Obsidian's Daily notes and the Periodic Notes plugin use.
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

type RawSettings = { enabled?: unknown; folder?: unknown; format?: unknown; template?: unknown };

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function settingsFrom(raw: RawSettings, period: Period): PeriodicNoteSettings {
	return {
		folder: text(raw.folder).replace(/^\/+|\/+$/g, ""),
		format: text(raw.format) || DEFAULT_FORMATS[period],
		template: text(raw.template),
	};
}

/**
 * Reads where the vault keeps its periodic notes. The Periodic Notes plugin
 * wins for a period it manages; daily notes otherwise come from Obsidian's
 * Daily notes core plugin. Returns null when nothing manages the period.
 */
export function getPeriodicNoteSettings(app: App, period: Period): PeriodicNoteSettings | null {
	const periodicNotes = app.plugins?.plugins?.["periodic-notes"] as
		| { settings?: Record<string, RawSettings | undefined> }
		| undefined;
	const managed = periodicNotes?.settings?.[period];
	if (managed?.enabled) return settingsFrom(managed, period);

	if (period !== "daily") return null;
	const dailyNotes = app.internalPlugins?.plugins?.["daily-notes"] as
		| { enabled?: boolean; instance?: { options?: RawSettings } }
		| undefined;
	if (!dailyNotes?.enabled) return null;
	return settingsFrom(dailyNotes.instance?.options ?? {}, period);
}

/** The note path (no extension) for the period containing `date`. */
export function periodicNotePath(settings: PeriodicNoteSettings, period: Period, date: Moment): string {
	// Snap first, like Periodic Notes: a week that starts in May files under May.
	const name = date.clone().startOf(PERIOD_UNITS[period]).format(settings.format);
	return settings.folder ? `${settings.folder}/${name}` : name;
}

/** Replaces every periodic-note token; an unmanaged period is a clear error. */
export function replacePeriodicNoteTokens(input: string, app: App | undefined, date: Moment): string {
	return input.replace(new RegExp(PERIODIC_NOTE_REGEX.source, "gi"), (_match, token: string) => {
		const period = token.toLowerCase() as Period;
		const settings = app ? getPeriodicNoteSettings(app, period) : null;
		if (!settings) {
			throw new Error(
				period === "daily"
					? "{{DAILY}} needs the Daily notes core plugin (or Periodic Notes with daily notes) turned on."
					: `{{${token.toUpperCase()}}} needs the Periodic Notes plugin with ${period} notes turned on.`,
			);
		}
		return periodicNotePath(settings, period, date);
	});
}

/**
 * The template the period's own plugin would create `path` from, when `path`
 * is that period's note for `date`. Lets a Capture into {{DAILY}} create a
 * missing daily note the same way Obsidian would.
 */
export function periodicNoteTemplateFor(app: App, path: string, date: Moment): string | null {
	const target = path.replace(/\.md$/i, "");
	for (const period of PERIODS) {
		const settings = getPeriodicNoteSettings(app, period);
		if (settings?.template && periodicNotePath(settings, period, date) === target) {
			return settings.template;
		}
	}
	return null;
}
