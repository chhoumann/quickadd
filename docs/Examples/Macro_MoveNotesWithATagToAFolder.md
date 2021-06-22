### Macro: Move notes with a tag to a folder
This script allows you to move notes with a certain tag to a folder.
![h44DF7W7Ef](https://user-images.githubusercontent.com/29108628/122404732-c18d6f00-cf7f-11eb-8a6f-17d47db8b015.gif)
```js
module.exports = async function moveFilesWithTag(params) {
    const {app, quickAddApi: {suggester, yesNoPrompt}} = params;
    const allTags = Object.keys(app.metadataCache.getTags());
    const tag = await suggester(allTags, allTags);
    if (!tag) return;
    const shouldMoveNested = await yesNoPrompt("Should I move nested tags, too?", `If you say no, I'll only move tags that are strictly equal to what you've chosen. If you say yes, I'll move tags that are nested under ${tag}.`);

    const cache = app.metadataCache.getCachedFiles();
    let filesToMove = [];
    
    cache.forEach(key => {
        if (key.contains("template")) return;
        const fileCache = app.metadataCache.getCache(key);
        let hasFrontmatterCacheTag, hasTag;
        
        if (!shouldMoveNested) {
            hasFrontmatterCacheTag = fileCache.frontmatter?.tags?.split(' ').some(t => t === tag.replace('#', ''));
            hasFrontmatterCacheTag = hasFrontmatterCacheTag || fileCache.frontmatter?.Tags?.split(' ').some(t => t === tag.replace('#', ''));
            hasFrontmatterCacheTag = hasFrontmatterCacheTag || fileCache.frontmatter?.tag?.split(' ').some(t => t === tag.replace('#', ''));
            hasFrontmatterCacheTag = hasFrontmatterCacheTag || fileCache.frontmatter?.Tag?.split(' ').some(t => t === tag.replace('#', ''));
            hasTag = fileCache?.tags?.some(t => t.tag === tag);
        } else {
            hasFrontmatterCacheTag = fileCache.frontmatter?.tags?.split(' ').some(t => t.contains(tag.replace('#', '')));
            hasFrontmatterCacheTag = hasFrontmatterCacheTag || fileCache.frontmatter?.Tags?.split(' ').some(t => t.contains(tag.replace('#', '')));
            hasFrontmatterCacheTag = hasFrontmatterCacheTag || fileCache.frontmatter?.tag?.split(' ').some(t => t.contains(tag.replace('#', '')));
            hasFrontmatterCacheTag = hasFrontmatterCacheTag || fileCache.frontmatter?.Tag?.split(' ').some(t => t.contains(tag.replace('#', '')));
            hasTag = fileCache?.tags?.some(t => t.tag.contains(tag));
        }
        
        if (hasFrontmatterCacheTag || hasTag) filesToMove.push(key);
    });

    const folders = app.vault.getAllLoadedFiles().filter(f => f.children).map(f => f.path);
    const targetFolder = await suggester(folders, folders);
    if (!targetFolder) return;

    for (const file of filesToMove) {
        const tfile = app.vault.getAbstractFileByPath(file);
        await app.fileManager.renameFile(tfile, `${targetFolder}/${tfile.name}`);
    }
}
```
