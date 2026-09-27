// Lists the properties in today's daily note, asks for a new value, and writes it back.
// Uses Obsidian's own app.fileManager.processFrontMatter; no other plugins needed.
// Docs: https://quickadd.obsidian.guide/docs/Examples/Macro_ChangePropertyInDailyNotes
const DAILY_NOTE_PATH = "Daily note path";

module.exports = {
	entry: start,
	settings: {
		name: "Change daily note property",
		author: "Christian B. B. Houmann",
		options: {
			[DAILY_NOTE_PATH]: {
				type: "format",
				defaultValue: "",
				placeholder: "Daily/{{DATE:YYYY-MM-DD}}.md",
				description:
					"Path of today's daily note, with QuickAdd date syntax. Leave empty to use the Daily notes core plugin's folder and date format.",
			},
		},
	},
};

async function start(params, settings) {
	const { app, quickAddApi, obsidian } = params;
	const path = await todaysDailyNotePath(app, quickAddApi, settings[DAILY_NOTE_PATH]);
	if (!path) {
		new obsidian.Notice("Enable the Daily notes core plugin or set Daily note path in the script settings.", 8000);
		return;
	}
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof obsidian.TFile)) {
		new obsidian.Notice(`No daily note at ${path}.`);
		return;
	}

	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	const keys = Object.keys(frontmatter).filter((key) => key !== "position");
	if (keys.length === 0) {
		new obsidian.Notice(`No properties in ${file.basename}`);
		return;
	}

	const key = await quickAddApi.suggester(keys, keys);
	if (!key) return;

	const current = frontmatter[key];
	const shown = String(current ?? "");
	const newValue = await quickAddApi.inputPrompt(`Log ${key}`, shown, shown);
	if (newValue === undefined || newValue === null) return;

	await app.fileManager.processFrontMatter(file, (fm) => {
		fm[key] = keepType(current, newValue);
	});
}

// An explicit path wins; otherwise today's note is where the Daily notes core
// plugin would create it. Returns null when neither is available.
async function todaysDailyNotePath(app, quickAddApi, setting) {
	const explicit = String(setting ?? "").trim();
	if (explicit) return quickAddApi.format(explicit, {});

	const dailyNotes = app.internalPlugins.plugins["daily-notes"];
	if (!dailyNotes?.enabled) return null;
	const { folder = "", format = "YYYY-MM-DD" } = dailyNotes.instance.options ?? {};
	const name = window.moment().format(format || "YYYY-MM-DD");
	const dir = String(folder).trim().replace(/^\/+|\/+$/g, "");
	return dir ? `${dir}/${name}.md` : `${name}.md`;
}

// Write numbers and booleans back as numbers and booleans when the new text still is one.
function keepType(current, text) {
	if (typeof current === "number" && text.trim() !== "" && Number.isFinite(Number(text))) {
		return Number(text);
	}
	if (typeof current === "boolean" && (text === "true" || text === "false")) {
		return text === "true";
	}
	return text;
}
