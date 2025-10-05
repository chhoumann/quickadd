const READWISE_API_OPTION = "Readwise API key";
const FILE_NAME_FORMAT = "File name format";
const IGNORE_EMPTY_PROPERTIES = "Ignore empty Properties";
const USE_CACHE = "Use cache";
const IMPORT_TYPE = "Import type";

const MANUAL_ENTRY = "Manual Entry";

const READWISE_API_URL = "https://readwise.io/api/v2/";
const READWISE_CACHE_KEY = "ez-import-readwise-cache";

/*
    Cache structure:
    {
        ...
        [item title]: {
            title: item title,
            createdFileWithItem: true/false,
            ignore: true/false,
        }
        ...
    }
*/

function getReadwiseCache() {
	if (!window.localStorage) return null;
	const cacheStr = window.localStorage.getItem(READWISE_CACHE_KEY);
	if (!cacheStr) return null;
	return JSON.parse(cacheStr);
}

function getCacheItem(itemKey) {
	if (!window.localStorage) return null;
	const cache = getReadwiseCache();
	if (!cache) return null;
	return cache[itemKey];
}

function setCacheItem(itemKey, item) {
	if (!window.localStorage) return null;
	const cache = getReadwiseCache() || {};
	if (!cache) {
		new Notice("No existing EzImport-Readwise cache. Creating one.", 10000);
	}

	cache[itemKey] = item;

	setCacheItems(cache);
}

function setCacheItems(items) {
	if (!window.localStorage) return null;
	window.localStorage.setItem(READWISE_CACHE_KEY, JSON.stringify(items));
}

const LogAndThrowError = (error) => {
	new Notice("error", 10000);
	throw new Error(error);
};

const EzImportType = Object.freeze({
	Article: "articles",
	YouTube_video: "youtube-video",
	Podcast_episode: "podcasts",
	Tweet: "tweets",
	Book: "books",
});

module.exports = {
	entry: async (params, settings) => {
		await start(params, settings, settings[IMPORT_TYPE]);
	},
	settings: {
		name: "EzImport",
		author: "Christian B. B. Houmann",
		options: {
			[READWISE_API_OPTION]: {
				type: "input",
				secret: true,
				placeholder: "Readwise API key",
			},
			[USE_CACHE]: {
				type: "toggle",
				defaultValue: false,
			},
			[IMPORT_TYPE]: {
				type: "dropdown",
				defaultValue: EzImportType.Article,
				options: Object.values(EzImportType),
			},
			[IGNORE_EMPTY_PROPERTIES]: {
				type: "toggle",
				defaultValue: true,
			},
			[FILE_NAME_FORMAT]: {
				type: "format",
				defaultValue: "",
				placeholder: "File name format for the note",
			},
		},
	},
};

let QuickAdd;
let Settings;

async function start(params, settings, type) {
	QuickAdd = params;
	Settings = settings;

	if (settings[READWISE_API_OPTION] == null) {
		LogAndThrowError("Please provide a valid Readwise API key.");
	}

	return await getReadwiseHighlights(type);
}

async function getReadwiseHighlights(type) {
	const results = await getHighlightsByCategory(type);
	if (!results || results.length === 0) {
		LogAndThrowError("No highlights found.");
	}

	const highlightItems = [];

	if (Settings[USE_CACHE]) {
		const cache = getReadwiseCache();
		if (cache) {
			for (const result of results) {
				const cacheItem = cache[result.title];
				if (
					!cacheItem ||
					(cacheItem && !cacheItem.ignore && !cacheItem.createdFileWithItem)
				) {
					highlightItems.push(result);
				}
			}
		} else {
			// No cache. Build.
			const newCache = {};
			for (const item of results) {
				newCache[item.title] = {
					title: item.title,
					createdFileWithItem: false,
				};
			}

			setCacheItems(newCache);
			highlightItems.push(...results);
		}
	} else {
		highlightItems.push(...results);
	}

	highlightItems.push({ title: MANUAL_ENTRY });

	const item = await QuickAdd.quickAddApi.suggester(
		highlightItems.map((item) => item.title),
		highlightItems
	);
	if (!item) {
		LogAndThrowError("No item selected.");
	}

	if (Settings[USE_CACHE]) {
		const cacheItem = getCacheItem(item.title);
		let newCacheItem;

		if (cacheItem) {
			newCacheItem = {
				...cacheItem,
				createdFileWithItem: true,
			};
		} else {
			newCacheItem = {
				title: item.title,
				createdFileWithItem: true,
			};
		}

		setCacheItem(item.title, newCacheItem);
	}

	const safeTitle = replaceIllegalFileNameCharactersInString(item.title);
	const fileName = await getFileName(safeTitle);

	QuickAdd.variables = {
		...QuickAdd.variables,
		safeTitle,
		fileName,
		title: item.title,
		author: `[[${item.author}]]`,
		source: item.source_url,
		tags: item?.tags?.map((tag) => tag.name).join(", "),
		cover: item.cover_image_url,
		lastHighlightAt: item.last_highlight_at,
		updated: item.updated,
		numHighlights: item.num_highlights,
	};
	if (Settings[IGNORE_EMPTY_PROPERTIES]) {
		for (const key of Object.keys(QuickAdd.variables)) {
			if (QuickAdd.variables[key] === "") {
				QuickAdd.variables[key] = " ";
			}
		}
	}

	const file = await QuickAdd.app.vault.getAbstractFileByPath(
		`${fileName.replace(".md", "")}.md`
	);
	if (file) {
		await handleAddToExistingFile(file, item);
	} else {
		await handleCreateSourceFile(item);
	}

	return fileName;
}

async function handleAddToExistingFile(file, item) {
	const lastHighlightAt =
		QuickAdd.app.metadataCache.getFileCache(file).frontmatter.lastHighlightAt;
	if (!lastHighlightAt) {
		LogAndThrowError("File does not have a lastHighlightAt property.");
	}

	const resolve = await getHighlightsAfterDateForItem(item, lastHighlightAt);
	const highlights = resolve.results.reverse();

	if (highlights.length > 0) {
		QuickAdd.variables.highlights = `\n${formatHighlights(highlights)}`;
		await QuickAdd.app.fileManager.processFrontMatter(file, (fm) => {
			fm.lastHighlightAt = item.last_highlight_at;

			return fm;
		});
		new Notice(
			`Added ${highlights.length} highlights to '${file.basename}'.`,
			10000
		);
	} else {
		// Throw so we don't continue the capture flow.
		LogAndThrowError(
			`No highlights found after ${new Date(lastHighlightAt).toISOString()}`
		);
	}
}

async function handleCreateSourceFile(item) {
	if (item.title === MANUAL_ENTRY) return;

	const resolve = await getHighlightsForItem(item);
	if (!resolve) {
		LogAndThrowError("No highlights found.");
	}

	const highlights = resolve.results.reverse();
	QuickAdd.variables.highlights = formatHighlights(highlights);
}

async function getFileName(safeTitle) {
	const fileNameFormat = Settings[FILE_NAME_FORMAT];
	const fileNameWithSafeTitle = fileNameFormat.replace(
		/{{VALUE:safeTitle}}/gi,
		safeTitle
	);

	return await QuickAdd.quickAddApi.format(fileNameWithSafeTitle);
}

function formatHighlights(highlights) {
	return highlights
		.filter((hl) => hl.text !== "No title")
		.map((hl) => {
			const { quote, note } = textFormatter(hl.text, hl.note);
			return `${quote}${note}`;
		})
		.join("\n\n");
}

function textFormatter(sourceText, sourceNote) {
	const quote = sourceText
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => {
			if (sourceNote.includes(".h1")) return `## ${line}`;
			if (sourceNote.includes(".h2")) return `### ${line}`;
			return `> ${line}`;
		})
		.join("\n");

	let note;

	if (
		sourceNote.includes(".h1") ||
		sourceNote.includes(".h2") ||
		sourceNote === "" ||
		!sourceNote
	) {
		note = "";
	} else {
		note = `\n\n${sourceNote}`;
	}

	return { quote, note };
}

async function getHighlightsByCategory(category) {
	const res = await apiGet(`${READWISE_API_URL}books`, {
		category: category,
		page_size: 1000,
	});

	return res.results;
}

async function getHighlightsForItem(element) {
	return apiGet(`${READWISE_API_URL}highlights`, {
		book_id: element.id,
		page_size: 1000,
	});
}

async function getHighlightsAfterDateForItem(element, date) {
	return apiGet(`${READWISE_API_URL}highlights`, {
		book_id: element.id,
		page_size: 1000,
		highlighted_at__gt: date,
	});
}

async function apiGet(url, data) {
	const finalURL = new URL(url);
	if (data) {
		for (const [key, value] of Object.entries(data)) {
			finalURL.searchParams.append(key, value);
		}
	}

	return await fetch(finalURL, {
		method: "GET",
		cache: "no-cache",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Token ${Settings[READWISE_API_OPTION]}`,
		},
	}).then(async (res) => await res.json());
}

function replaceIllegalFileNameCharactersInString(string) {
	return string
		.replace(/[\\,#%&{}/*<>$'":@\u2023|?]*/g, "") // Replace illegal file name characters with empty string
		.replace(/\n/, " ") // replace newlines with spaces
		.replace("  ", " "); // replace multiple spaces with single space to make sure we don't have double spaces in the file name
}
