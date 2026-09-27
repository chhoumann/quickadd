// Asks which book you are reading and writes it to a property in today's daily note.
// Uses Obsidian's own app.fileManager.processFrontMatter; no other plugins needed.
// Docs: https://quickadd.obsidian.guide/docs/Examples/Macro_LogBookToDailyJournal
const DAILY_NOTE_PATH = "Daily note path";
const PROPERTY_NAME = "Property name";
const DEFAULT_PATH = "Daily/{{DATE:gggg-MM-DD - ddd MMM D}}.md";

module.exports = {
	entry: start,
	settings: {
		name: "Log book",
		author: "Christian B. B. Houmann",
		options: {
			[DAILY_NOTE_PATH]: {
				type: "format",
				defaultValue: DEFAULT_PATH,
				placeholder: DEFAULT_PATH,
				description: "Path of today's daily note, with QuickAdd date syntax.",
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
	const path = await quickAddApi.format(settings[DAILY_NOTE_PATH] || DEFAULT_PATH, {});
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
