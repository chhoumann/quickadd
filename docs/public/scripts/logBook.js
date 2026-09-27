// Asks which book you are reading and writes it to a property in today's daily note.
// Uses Obsidian's own app.fileManager.processFrontMatter; no other plugins needed.
// Docs: https://quickadd.obsidian.guide/docs/Examples/Macro_LogBookToDailyJournal
const DAILY_NOTE_PATH = "Daily note path";
const PROPERTY_NAME = "Property name";

module.exports = {
	entry: start,
	settings: {
		name: "Log book",
		author: "Christian B. B. Houmann",
		options: {
			[DAILY_NOTE_PATH]: {
				type: "format",
				defaultValue: "",
				placeholder: "Daily/{{DATE:YYYY-MM-DD}}.md",
				description:
					"Path of today's daily note, with QuickAdd date syntax. Leave empty to use the Daily notes core plugin's folder and date format.",
			},
			[PROPERTY_NAME]: {
				type: "text",
				defaultValue: "Book",
				placeholder: "Book",
				description: "Frontmatter property to write.",
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

	const prop = String(settings[PROPERTY_NAME] || "Book").trim() || "Book";
	const value = await quickAddApi.inputPrompt("📖 Book name");
	if (!value) return;

	await app.fileManager.processFrontMatter(file, (fm) => {
		fm[prop] = value;
	});
	new obsidian.Notice(`Logged "${value}" to ${prop} in ${file.basename}`);
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
