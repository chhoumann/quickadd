export function makeFakeApp(selection = "") {
	return {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: () => {}, popScope: () => {} },
		workspace: {
			containerEl: document.body,
			on: () => ({}),
			getActiveFile: () => null,
			getActiveViewOfType: () =>
				selection
					? { editor: { getSelection: () => selection } }
					: undefined,
		},
		metadataCache: {
			on: () => ({}),
			getTags: () => ({}),
			getFileCache: () => undefined,
			isUserIgnored: () => false,
			unresolvedLinks: {},
		},
		vault: {
			on: () => ({}),
			getMarkdownFiles: () => [],
			getAllLoadedFiles: () => [],
			getFiles: () => [],
			getAbstractFileByPath: () => null,
		},
		fileManager: { getNewFileParent: () => ({ path: "" }) },
	};
}
