// Lists the properties in today's daily note, asks for a new value, and writes it back.
// Uses Obsidian's own app.fileManager.processFrontMatter; no other plugins needed.
// Docs: https://quickadd.obsidian.guide/docs/Examples/Macro_ChangePropertyInDailyNotes
const DAILY_NOTE_PATH = "Daily note path";
const DEFAULT_PATH = "Daily/{{DATE:gggg-MM-DD - ddd MMM D}}.md";

module.exports = {
	entry: start,
	settings: {
		name: "Change daily note property",
		author: "Christian B. B. Houmann",
		options: {
			[DAILY_NOTE_PATH]: {
				type: "format",
				defaultValue: DEFAULT_PATH,
				placeholder: DEFAULT_PATH,
				description: "Path of today's daily note, with QuickAdd date syntax.",
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
