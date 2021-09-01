const READWISE_API_OPTION = "Readwise API key";
const ARTICLE_FORMAT = "Article file name format";
const YOUTUBE_VIDEO_FORMAT = "YouTube video file name format";
const PODCAST_FORMAT = "Podcast episode file name format";
const TWEET_FORMAT = "Tweet file name format";
const BOOK_FORMAT = "Book file name format";
const IGNORE_EMPTY_PROPERTIES = "Ignore empty Properties";

const READWISE_API_URL = "https://readwise.io/api/v2/";

const LogAndThrowError = (error) => {
    new Notice("error", 10000);
    throw new Error(error);
};

const EzImportType = Object.freeze({
    Article: "articles",
    YouTube_video: "youtube-video",
    Podcast_episode: "podcasts",
    Tweet: "tweets",
    Book: "books"
});

module.exports = {
    entry: () => {
        new Notice("Please use one of the specific entry points.", 10000);
    },
    settings: {
        name: "EzImport",
        author: "Christian B. B. Houmann",
        options: {
            [READWISE_API_OPTION]: {
                type: "input",
                placeholder: "Readwise API key",
            },
            [IGNORE_EMPTY_PROPERTIES]: {
                type: "toggle",
                defaultValue: true,
            },
            [ARTICLE_FORMAT]: {
                type: "format",
                defaultValue: "",
                placeholder: "Article file name format",
            },
            [YOUTUBE_VIDEO_FORMAT]: {
                type: "format",
                defaultValue: "",
                placeholder: "YouTube video file name format",
            },
            [PODCAST_FORMAT]: {
                type: "format",
                defaultValue: "",
                placeholder: "Podcast episode file name format",
            },
            [TWEET_FORMAT]: {
                type: "format",
                defaultValue: "",
                placeholder: "Tweet file name format",
            },
            [BOOK_FORMAT]: {
                type: "format",
                defaultValue: "",
                placeholder: "Book file name format",
            },
        }
    },
    article: (params, settings) => start(params, settings, EzImportType.Article),
    podcastEpisode: (params, settings) => start(params, settings, EzImportType.Podcast_episode),
    tweet: (params, settings) => start(params, settings, EzImportType.Tweet),
    book: (params, settings) => start(params, settings, EzImportType.Book),
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
    const resolve = await getHighlightsByCategory(type);
    if (!resolve) {
        LogAndThrowError("No highlights found.");
    }

    const {results} = resolve;
    const item = await QuickAdd.quickAddApi.suggester(results.map(item => item.title), results);
    if (!item) {
        LogAndThrowError("No item selected.");
    }

    const safeTitle = replaceIllegalFileNameCharactersInString(item.title);
    const fileName = await getFileName(type, safeTitle);

    QuickAdd.variables = {
        ...QuickAdd.variables,
        safeTitle,
        fileName,
        title: item.title,
        author: `[[${item.author}]]`,
        source: item.source_url,
        tags: item.tags.map(tag => tag.name).join(", "),
        cover: item.cover_image_url,
        lastHighlightAt: item.last_highlight_at,
        updated: item.updated,
        numHighlights: item.num_highlights,
    };

    if (Settings[IGNORE_EMPTY_PROPERTIES]) {
        Object.keys(QuickAdd.variables).forEach(key => {
            if (QuickAdd.variables[key] === "") {
                QuickAdd.variables[key] = " ";
            }
        });
    }

    const file = await QuickAdd.app.vault.getAbstractFileByPath(`${fileName.replace('.md', '')}.md`);
    if (file) {
        await handleAddToExistingFile(file, item);
    } else {
        await handleCreateSourceFile(item);
    }

    return fileName;
}

async function handleAddToExistingFile(file, item) {
    const { update } = QuickAdd.app.plugins.plugins["metaedit"].api;
    const lastHighlightAt = QuickAdd.app.metadataCache.getFileCache(file).frontmatter["lastHighlightAt"];
    if (!lastHighlightAt) {
        LogAndThrowError("File does not have a lastHighlightAt property.");
    }

    const resolve = await getHighlightsAfterDateForItem(item, lastHighlightAt);
    const highlights = resolve.results.reverse();

    if (highlights.length > 0) {
        QuickAdd.variables.highlights = `\n${formatHighlights(highlights)}`;
        await update("lastHighlightAt", item.last_highlight_at, file);
        new Notice(`Added ${highlights.length} highlights to '${file.basename}'.`, 10000);
    } else {
        // Throw so we don't continue the capture flow.
        LogAndThrowError(`No highlights found after ${new Date(lastHighlightAt).toISOString()}`);
    }
}

async function handleCreateSourceFile(item) {
    const resolve = await getHighlightsForItem(item);
    if (!resolve) {
        LogAndThrowError("No highlights found.");
    }

    const highlights = resolve.results.reverse();
    QuickAdd.variables.highlights = formatHighlights(highlights);
}

async function getFileName(type, safeTitle) {
    let fileNameFormat;

    switch (type) {
        case EzImportType.Article:
            fileNameFormat = Settings[ARTICLE_FORMAT];
            break;
        case EzImportType.YouTube_video:
            fileNameFormat = Settings[YOUTUBE_VIDEO_FORMAT];
            break;
        case EzImportType.Podcast_episode:
            fileNameFormat = Settings[PODCAST_FORMAT];
            break;
        case EzImportType.Tweet:
            fileNameFormat = Settings[TWEET_FORMAT];
            break;
        case EzImportType.Book:
            fileNameFormat = Settings[BOOK_FORMAT];
            break;
    }

    fileNameFormat = fileNameFormat.replace(/{{VALUE:safeTitle}}/g, safeTitle);
    return await QuickAdd.quickAddApi.format(fileNameFormat);
}

function formatHighlights(highlights) {
    return highlights.map(hl => {
        if (hl.text == "No title") return;
        const {quote, note} = textFormatter(hl.text, hl.note);
        return `${quote}${note}`;
    }).join("\n\n");
}

function textFormatter(sourceText, sourceNote) {
    let quote = sourceText.split("\n").filter(line => line != "").map(line => {
        if (sourceNote.includes(".h1"))
            return `## ${line}`;
        else
            return `> ${line}`;
    }).join("\n");

    let note;

    if (sourceNote.includes(".h1") || sourceNote == "" || !sourceNote) {
        note = "";
    } else {
        note = "\n\n" + sourceNote;
    }

    return {quote, note};
}

async function getHighlightsByCategory(category) {
    return apiGet(`${READWISE_API_URL}books`, {category, "page_size": 1000});
}

async function getHighlightsForItem(element) {
    return apiGet(`${READWISE_API_URL}highlights`, {book_id: element.id, page_size: 1000});
}

async function getHighlightsAfterDateForItem(element, date) {
    return apiGet(`${READWISE_API_URL}highlights`, {book_id: element.id, page_size: 1000, highlighted_at__gt: date});
}

async function apiGet(url, data) {
    let finalURL = new URL(url);
    if (data)
        Object.keys(data).forEach(key => finalURL.searchParams.append(key, data[key]));

    return await fetch(finalURL, {
        method: 'GET', cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Token ${Settings[READWISE_API_OPTION]}`
        },
    }).then(async (res) => await res.json());
}

function replaceIllegalFileNameCharactersInString(string) {
    return string
        .replace(/[\\,#%&\{\}\/*<>$\'\":@]*/g, '') // Replace illegal file name characters with empty string
        .replace(/\n/, ' ') // replace newlines with spaces
        .replace('  ', ' '); // replace multiple spaces with single space to make sure we don't have double spaces in the file name
}