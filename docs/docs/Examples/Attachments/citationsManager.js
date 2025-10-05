module.exports = {
	entry: start,
	settings: {
		name: "Citations Manager",
		author: "Christian B. B. Houmann",
		options: {
			"Ignore empty values": {
				type: "toggle",
				defaultValue: true,
			},
		},
	},
};

const ignoreEmpty = "Ignore empty values";

async function start(params, settings) {
	const citationsPlugin =
		params.app.plugins.plugins["obsidian-citation-plugin"];

	if (citationsPlugin) {
		await handleCitationsPlugin(params, citationsPlugin, settings);
	} else {
		new Notice("Citations plugin not found.", 5000);
		throw new Error("Citations plugin not found.");
	}
}

async function handleCitationsPlugin(params, citationsPlugin, settings) {
	// Open suggester with library
	const library = citationsPlugin.library.entries;
	const selectedLibraryEntryKey = await params.quickAddApi.suggester(
		(entry) => {
			const item = library[entry];
			if (item.title) return item.title;
			return entry;
		},
		Object.keys(library)
	);
	const entry = library[selectedLibraryEntryKey];

	if (!entry && !selectedLibraryEntryKey) {
		new Notice("No library entry selected.", 5000);
		throw new Error("No library entry selected.");
	} else if (!entry) {
		new Notice(
			`Invalid entry. Selected library entry: ${selectedLibraryEntryKey}`,
			5000
		);
		throw new Error(
			`Invalid entry. Selected library entry: ${selectedLibraryEntryKey}`
		);
	}

	params.variables = {
		...params.variables,
		fileName: replaceIllegalFileNameCharactersInString(entry.title),
		citekey: selectedLibraryEntryKey,
		id: selectedLibraryEntryKey,
		author: entry.authorString
			.split(", ")
			.map((author) => `[[${author}]]`)
			.join(", "),
		doi: entry.DOI,

		// https://github.com/hans/obsidian-citation-plugin/blob/cb601fceda8c70c0404dd250c50cdf83d5d04979/src/types.ts#L46
		abstract: entry.abstract,
		authorString: entry.authorString,
		containerTitle: entry.containerTitle,
		DOI: entry.DOI,
		eprint: entry.eprint,
		eprinttype: entry.eprinttype,
		eventPlace: entry.eventPlace,
		note: entry.note,
		page: entry.page,
		publisher: entry.publisher,
		publisherPlace: entry.publisherPlace,
		title: entry.title,
		URL: entry.URL,
		year: entry.year?.toString(),
		zoteroSelectURI: entry.zoteroSelectURI,
		type: entry.type,
		issuedDate: entry.issuedDate,
		keywords: entry?.data?.fields?.keywords
			? importAllKeywordsAsTags(entry.data.fields.keywords)
			: "",
	};

	if (settings[ignoreEmpty]) {
		Object.keys(params.variables).forEach((key) => {
			if (params.variables[key] === undefined) {
				params.variables[key] = " ";
			}
		});
	}
}

function replaceIllegalFileNameCharactersInString(string) {
	return string.replace(/[\\,#%&{}/*<>$'":@?]*/g, "");
}

function importAllKeywordsAsTags(keywords) {
	return keywords.map((element) => ` #${element.replace(" ", "_")}`);
}
