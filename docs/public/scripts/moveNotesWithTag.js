// Moves every note carrying a chosen tag (frontmatter or inline) to a chosen folder.
// Docs: https://quickadd.obsidian.guide/docs/Examples/Macro_MoveNotesWithATagToAFolder
module.exports = async function moveFilesWithTag(params) {
	const {
		app,
		quickAddApi: { suggester, yesNoPrompt },
	} = params;
	const allTags = Object.keys(app.metadataCache.getTags());
	const tag = await suggester(allTags, allTags);
	if (!tag) return;
	const shouldMoveNested = await yesNoPrompt(
		"Should I move nested tags, too?",
		`If you say no, I'll only move tags that are strictly equal to what you've chosen. If you say yes, I'll move tags that are nested under ${tag}.`
	);

	const cache = app.metadataCache.getCachedFiles();
	let filesToMove = [];

	// Helper function to get tags as array from frontmatter
	// Handles both string format ("tag1 tag2", "tag1, tag2") and array format (["tag1", "tag2"])
	function getTagsAsArray(tagValue) {
		if (!tagValue) return [];
		if (Array.isArray(tagValue)) return tagValue;
		if (typeof tagValue === 'string') return tagValue.split(/[\s,]+/).filter(Boolean);
		return [];
	}

	// `#project` matches `#project`, and with nested tags also `#project/work`,
	// but never `#projectile`.
	const cleanTag = tag.replace(/^#/, "");
	const matches = (candidate) => {
		const clean = String(candidate).replace(/^#/, "");
		return clean === cleanTag || (shouldMoveNested && clean.startsWith(cleanTag + "/"));
	};

	cache.forEach((key) => {
		// Skip template notes wherever they live, for example Templates/ or _templates/.
		if (key.toLowerCase().includes("template")) return;
		const fileCache = app.metadataCache.getCache(key);
		if (!fileCache) return;

		// Check if file has the tag we're looking for
		let hasMatchingTag = false;

		// Check frontmatter tags (supports tags, Tags, tag, Tag)
		if (fileCache.frontmatter) {
			const tagFields = ['tags', 'Tags', 'tag', 'Tag'];
			hasMatchingTag = tagFields.some((field) =>
				getTagsAsArray(fileCache.frontmatter[field]).some(matches)
			);
		}

		// Check inline tags (#tag in the note content)
		if (!hasMatchingTag && fileCache.tags) {
			hasMatchingTag = fileCache.tags.some((t) => matches(t.tag));
		}

		if (hasMatchingTag) filesToMove.push(key);
	});

	if (filesToMove.length === 0) {
		new Notice(`No notes carry ${tag}.`);
		return;
	}

	const folders = app.vault
		.getAllLoadedFiles()
		.filter((f) => f.children)
		.map((f) => f.path);
	const noun = filesToMove.length === 1 ? "note" : "notes";
	const targetFolder = await suggester(folders, folders, `Move ${filesToMove.length} ${noun} to…`);
	if (!targetFolder) return;

	let moved = 0;
	let alreadyThere = 0;
	const nameTaken = [];
	for (const file of filesToMove) {
		// A note can be deleted or moved while the folder prompt is open.
		const tfile = app.vault.getAbstractFileByPath(file);
		if (!tfile) continue;
		const newPath = targetFolder === "/" ? tfile.name : `${targetFolder}/${tfile.name}`;
		if (newPath === tfile.path) {
			alreadyThere++;
			continue;
		}
		// renameFile throws on an occupied destination, which would abort the
		// batch halfway; skip the note and say so instead. This also catches two
		// tagged notes that share a name, since the first one to move takes it.
		if (app.vault.getAbstractFileByPath(newPath)) {
			nameTaken.push(tfile.path);
			continue;
		}
		await app.fileManager.renameFile(tfile, newPath);
		moved++;
	}
	const parts = [`Moved ${moved} ${moved === 1 ? "note" : "notes"} to ${targetFolder}.`];
	if (alreadyThere) parts.push(`${alreadyThere} already there.`);
	if (nameTaken.length) {
		parts.push(`Skipped ${nameTaken.length} whose name is taken there: ${nameTaken.join(", ")}.`);
	}
	new Notice(parts.join(" "), nameTaken.length ? 10000 : undefined);
};
