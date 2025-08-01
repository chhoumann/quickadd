---
title: "Macro: Move notes with a tag to a folder"
---

This script allows you to move notes with a certain tag to a folder.
![h44DF7W7Ef](https://user-images.githubusercontent.com/29108628/122404732-c18d6f00-cf7f-11eb-8a6f-17d47db8b015.gif)

```js
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
	// Handles both string format ("tag1 tag2") and array format (["tag1", "tag2"])
	function getTagsAsArray(tagValue) {
		if (!tagValue) return [];
		if (Array.isArray(tagValue)) return tagValue;
		if (typeof tagValue === 'string') return tagValue.split(" ");
		return [];
	}

	cache.forEach((key) => {
		if (key.contains("template")) return;
		const fileCache = app.metadataCache.getCache(key);
		
		// Check if file has the tag we're looking for
		let hasMatchingTag = false;
		const cleanTag = tag.replace("#", "");

		// Check frontmatter tags (supports tags, Tags, tag, Tag)
		if (fileCache.frontmatter) {
			const tagFields = ['tags', 'Tags', 'tag', 'Tag'];
			
			for (const field of tagFields) {
				const tagsArray = getTagsAsArray(fileCache.frontmatter[field]);
				
				if (!shouldMoveNested) {
					// Exact match
					if (tagsArray.some(t => t === cleanTag)) {
						hasMatchingTag = true;
						break;
					}
				} else {
					// Nested match (contains)
					if (tagsArray.some(t => t.includes(cleanTag))) {
						hasMatchingTag = true;
						break;
					}
				}
			}
		}

		// Check inline tags (#tag in the note content)
		if (!hasMatchingTag && fileCache.tags) {
			if (!shouldMoveNested) {
				hasMatchingTag = fileCache.tags.some(t => t.tag === tag);
			} else {
				hasMatchingTag = fileCache.tags.some(t => t.tag.includes(tag));
			}
		}

		if (hasMatchingTag) filesToMove.push(key);
	});

	const folders = app.vault
		.getAllLoadedFiles()
		.filter((f) => f.children)
		.map((f) => f.path);
	const targetFolder = await suggester(folders, folders);
	if (!targetFolder) return;

	for (const file of filesToMove) {
		const tfile = app.vault.getAbstractFileByPath(file);
		await app.fileManager.renameFile(
			tfile,
			`${targetFolder}/${tfile.name}`
		);
	}
};
```
