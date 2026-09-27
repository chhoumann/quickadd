// Creates one linked note per heading of a chosen level in the active note.
// Docs: https://quickadd.obsidian.guide/docs/Examples/Macro_Zettelizer
const FOLDER = "Folder for new notes";
const HEADING_LEVEL = "Heading level";

module.exports = {
    entry: start,
    settings: {
        name: "Zettelizer",
        author: "Christian B. B. Houmann",
        options: {
            [FOLDER]: {
                type: "text",
                defaultValue: "Zettels",
                placeholder: "Zettels",
                description: "Folder the new notes go in (created if missing). Leave empty for the vault root.",
            },
            [HEADING_LEVEL]: {
                type: "dropdown",
                options: ["1", "2", "3", "4", "5", "6"],
                defaultValue: "3",
                description: "Only headings of this level become notes (3 means ### headings).",
            },
        },
    },
};

async function start(params, settings) {
    const { app } = params;
    const currentFile = app.workspace.getActiveFile();
    if (!currentFile) {
        new Notice("No active file.");
        return;
    }

    const currentFileCache = app.metadataCache.getFileCache(currentFile);
    const headingsInFile = currentFileCache && currentFileCache.headings;
    if (!headingsInFile) {
        new Notice(`No headers in file ${currentFile.name}`);
        return;
    }

    const folder = String(settings[FOLDER] ?? "").trim().replace(/^\/+|\/+$/g, "");
    const level = Number(settings[HEADING_LEVEL] || 3);

    if (folder && !(await app.vault.adapter.exists(folder))) {
        try {
            await app.vault.createFolder(folder);
        } catch (error) {
            if (!String(error && error.message).includes("already exists")) throw error;
        }
    }

    for (const heading of headingsInFile) {
        if (heading.level !== level) continue;

        const splitHeading = heading.heading.split(" ");
        const location = splitHeading[0].trim();
        const text = splitHeading.length > 1 ? splitHeading.slice(1).join(" ").trim() : "";
        if (!text) continue;

        const fileName = `${text.replace(/[\\,#%&\{\}\/*<>$\'\":@]*/g, "")}.md`;
        const path = folder ? `${folder}/${fileName}` : fileName;
        const content = `![[${currentFile.basename}#${location} ${text}]]`;

        if (await app.vault.adapter.exists(path)) {
            new Notice(`File ${path} already exists.`, 5000);
            continue;
        }
        await app.vault.create(path, content);
    }
}
