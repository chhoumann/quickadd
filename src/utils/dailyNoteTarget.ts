import { normalizePath, type App } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

export interface DailyNoteSettings {
	folder: string;
	format: string;
	template: string;
}

interface RawDailyNoteSettings {
	enabled?: boolean;
	folder?: string;
	format?: string;
	template?: string;
}

/**
 * Where the vault keeps its daily notes. Periodic Notes takes over daily notes
 * when its daily section is on (the same rule Calendar and other plugins follow
 * through obsidian-daily-notes-interface); otherwise the Daily notes core plugin
 * decides. Obsidian's own defaults fill anything left blank.
 */
export function getDailyNoteSettings(app: App): DailyNoteSettings {
	const periodic = (
		app.plugins?.plugins?.["periodic-notes"] as
			| { settings?: { daily?: RawDailyNoteSettings } }
			| undefined
	)?.settings?.daily;
	const core = (
		app.internalPlugins?.plugins?.["daily-notes"] as
			| { instance?: { options?: RawDailyNoteSettings } }
			| undefined
	)?.instance?.options;
	const raw = periodic?.enabled ? periodic : (core ?? {});
	const template = raw.template?.trim() ?? "";
	return {
		folder: raw.folder?.trim() ?? "",
		format: raw.format?.trim() || "YYYY-MM-DD",
		template: template && !template.endsWith(".md") ? `${template}.md` : template,
	};
}

/** The daily note's path as QuickAdd format syntax, so "Which day" picks the date. */
export function dailyNotePathFormat(settings: DailyNoteSettings): string {
	const fileName = `{{DATE:${settings.format}}}.md`;
	return normalizePath(settings.folder ? `${settings.folder}/${fileName}` : fileName);
}

/**
 * A daily-note Capture runs as a plain path Capture: the daily note's path,
 * created from the daily-note template when it doesn't exist yet. Every other
 * choice is returned unchanged.
 */
export function resolveDailyNoteTarget(
	app: App,
	choice: ICaptureChoice,
): ICaptureChoice {
	if (!choice.captureToDailyNote) return choice;
	const settings = getDailyNoteSettings(app);
	return {
		...choice,
		captureToActiveFile: false,
		captureTo: dailyNotePathFormat(settings),
		captureToCanvasNodeId: "",
		createFileIfItDoesntExist: {
			enabled: true,
			createWithTemplate: settings.template !== "",
			template: settings.template,
		},
	};
}
