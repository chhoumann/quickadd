import { TFile, type App } from "obsidian";
import type { Moment } from "moment";
import { usesMarkdownLinks } from "./fileLinks";

/**
 * `{{DAILY}}` is the vault path, without extension, of the run day's daily
 * note. `{{DAILY|link}}` is a link to it.
 */
export const DAILY_NOTE_REGEX = /{{DAILY(\|link)?}}/i;

export interface DailyNoteSettings {
	/** The plugin that owns daily notes. The two fill templates differently. */
	source: "daily-notes" | "periodic-notes";
	folder: string;
	format: string;
	template: string;
}

const DEFAULT_FORMAT = "YYYY-MM-DD";

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function vaultPath(path: string): string {
	return path.replace(/[\\/]+/g, "/").replace(/^\/|\/$/g, "");
}

function settingsFrom(source: DailyNoteSettings["source"], raw: Record<string, unknown>): DailyNoteSettings {
	return {
		source,
		folder: vaultPath(text(raw.folder)),
		format: text(raw.format) || DEFAULT_FORMAT,
		template: vaultPath(text(raw.template)),
	};
}

/**
 * Where the vault keeps daily notes. Periodic Notes wins while it manages daily
 * notes, as it does in Obsidian. The settings are other plugins' internals, so
 * every field is checked before use.
 */
export function getDailyNoteSettings(app: App | undefined): DailyNoteSettings {
	const periodicNotes = record(record(app?.plugins?.plugins?.["periodic-notes"])?.settings);
	// Periodic Notes 1.0 (beta) keeps its settings in calendar sets. Reading only
	// core Daily notes there could target a different note than the one it opens.
	if (periodicNotes && "calendarSets" in periodicNotes) {
		throw new Error("{{DAILY}} can't read the settings of Periodic Notes 1.0. Use Periodic Notes 0.0.17, or turn it off and use the Daily notes core plugin.");
	}
	const periodicDaily = record(periodicNotes?.daily);
	if (periodicDaily?.enabled === true) return settingsFrom("periodic-notes", periodicDaily);

	const dailyNotes = record(app?.internalPlugins?.plugins?.["daily-notes"]);
	if (dailyNotes?.enabled === true) {
		return settingsFrom("daily-notes", record(record(dailyNotes.instance)?.options) ?? {});
	}
	throw new Error("{{DAILY}} needs the Daily notes core plugin, or Periodic Notes with daily notes, turned on.");
}

/** The daily note's vault path, without extension, for the day of `date`. */
export function dailyNotePath(settings: DailyNoteSettings, date: Moment): string {
	const name = date.format(settings.format).trim();
	if (!name) throw new Error(`The daily note format "${settings.format}" gives an empty file name.`);
	return settings.folder ? `${settings.folder}/${name}` : name;
}

/**
 * A link that follows the vault's link settings when the note exists. A missing
 * note gets its full path, so following the link creates it in the daily notes
 * folder rather than in the default location for new notes.
 */
export function dailyNoteLink(app: App, path: string, sourcePath: string): string {
	const file = app.vault.getAbstractFileByPath(`${path}.md`);
	if (file instanceof TFile) return app.fileManager.generateMarkdownLink(file, sourcePath);
	if (!usesMarkdownLinks(app)) return `[[${path}]]`;
	return `[${path.split("/").pop()}](${encodeURI(`${path}.md`)})`;
}

/**
 * The daily note template's contents, or null when none is set. The two plugins
 * look the template up differently: Daily notes by vault path, Periodic Notes
 * as a link. A template that is set but missing stops the run.
 */
export async function readDailyNoteTemplate(app: App, settings: DailyNoteSettings): Promise<string | null> {
	const { template } = settings;
	if (!template) return null;
	const file = settings.source === "daily-notes"
		? app.vault.getAbstractFileByPath(/\.[^/.]+$/.test(template) ? template : `${template}.md`)
		: app.metadataCache.getFirstLinkpathDest(template, "");
	if (!(file instanceof TFile)) {
		const where = settings.source === "daily-notes" ? "Daily notes" : "Periodic Notes";
		throw new Error(`The daily note template "${template}" doesn't exist. Fix it in Settings → ${where}.`);
	}
	return app.vault.cachedRead(file);
}

/**
 * Fills a daily note template with the placeholders of the plugin that owns it,
 * so QuickAdd creates the note Obsidian would. QuickAdd's own format syntax is
 * not applied, since the template is written for that plugin.
 *
 * - Daily notes: `{{date}}` and `{{time}}` are the moment the note is created,
 *   optionally `{{date:<format>}}`; `{{title}}` is the file name. Names are
 *   case-insensitive and allow no spaces inside the braces.
 * - Periodic Notes 0.0.17 (through obsidian-daily-notes-interface):
 *   `{{date}}`/`{{title}}` are the file name, `{{date:<format>}}` and
 *   `{{date+1d:<format>}}` are the note's day, `{{yesterday}}`/`{{tomorrow}}`
 *   are the neighbouring days' names, and `{{time}}` is now.
 *
 * `day` is the note's day; `now` is the moment the note is created.
 */
export function renderDailyNoteTemplate(
	content: string,
	settings: DailyNoteSettings,
	day: Moment,
	now: Moment,
): string {
	const { format } = settings;
	if (settings.source === "daily-notes") {
		const title = day.format(format).trim();
		return content.replace(/{{(date|time|title)(?::([^}]*))?}}/gi, (match: string, name: string, custom?: string) => {
			const kind = name.toLowerCase();
			if (kind === "title") return custom === undefined ? title : match;
			return now.format(custom || (kind === "date" ? "YYYY-MM-DD" : "HH:mm"));
		});
	}

	const filename = day.format(format);
	return content
		.replace(/{{\s*date\s*}}/gi, filename)
		.replace(/{{\s*time\s*}}/gi, now.format("HH:mm"))
		.replace(/{{\s*title\s*}}/gi, filename)
		.replace(
			/{{\s*(date|time)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
			(_match: string, _kind: string, calc?: string, delta?: string, unit?: string, custom?: string) => {
				const moment = day.clone().set({ hour: now.hour(), minute: now.minute(), second: now.second() });
				if (calc && delta && unit) moment.add(parseInt(delta, 10), unit as "d");
				return custom ? moment.format(custom.substring(1).trim()) : moment.format(format);
			},
		)
		.replace(/{{\s*yesterday\s*}}/gi, day.clone().subtract(1, "day").format(format))
		.replace(/{{\s*tomorrow\s*}}/gi, day.clone().add(1, "d").format(format));
}
