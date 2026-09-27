// Pulls books, articles and highlights from Readwise into notes.
// entry lets you pick a category and item; getBooks picks a book title (use it in a
// file name format), instaFetchBook writes that book's highlights, getDailyQuote
// returns a random supplemental highlight as a quote.
// Docs: https://quickadd.obsidian.guide/docs/Examples/Template_AutomaticBookNotesFromReadwise
const ACCESS_TOKEN = "Readwise access token";

module.exports = {
	entry: start,
	settings: {
		name: "Readwise",
		author: "Christian B. B. Houmann",
		options: {
			[ACCESS_TOKEN]: {
				type: "secret",
				id: "readwise-access-token",
				placeholder: "Paste access token",
				description: "From readwise.io/access_token.",
			},
		},
	},
	getDailyQuote,
	instaFetchBook,
	getBooks,
};
const apiUrl = "https://readwise.io/api/v2/";
const books = "📚 Books",
	articles = "📰 Articles",
	tweets = "🐤 Tweets",
	supplementals = "💭 Supplementals",
	podcasts = "🎙 Podcasts",
	searchAll = "🔍 Search All Highlights (slow!)";
const categories = {
	books,
	articles,
	tweets,
	supplementals,
	podcasts,
	searchAll,
};
const randomNumberInRange = (max) => Math.floor(Math.random() * max);
let token;
let quickAddApi;

function useToken(params, settings) {
	token = (settings?.[ACCESS_TOKEN] ?? "").trim();
	if (!token) {
		new params.obsidian.Notice("Set your Readwise access token in the script settings.");
		throw new Error("Readwise access token is not set.");
	}
}

async function start(params, settings) {
	useToken(params, settings);
	({ quickAddApi } = params);
	let highlights;
	const category = await categoryPromptHandler();
	if (!category) return;

	if (category === "searchAll") {
		highlights = await getAllHighlights();
	} else {
		let res = await getHighlightsByCategory(category);
		if (!res) return;

		const { results } = res;
		const item = await quickAddApi.suggester(
			results.map((item) => item.title),
			results
		);
		if (!item) return;

		params.variables["author"] = `[[${item.author}]]`;

		const res2 = await getHighlightsForElement(item);
		if (!res2) return;

		highlights = res2.results.reverse();
	}

	const textToAppend = await highlightsPromptHandler(highlights);
	return !textToAppend ? "" : textToAppend;
}

async function getBooks(params, settings) {
	useToken(params, settings);
	const { results: books } = await getHighlightsByCategory("books");
	const bookNames = books.map((book) => book.title);
	const selectedBook = await params.quickAddApi.suggester(
		bookNames,
		bookNames
	);
	params.variables["Book Title"] = selectedBook;
	return selectedBook;
}

async function instaFetchBook(params, settings) {
	useToken(params, settings);
	const bookTitle = params.variables["Book Title"];
	if (!bookTitle) return await start(params, settings);

	const { results: books } = await getHighlightsByCategory("books");
	const book = books.find((b) =>
		b.title.toLowerCase().contains(bookTitle.toLowerCase())
	);
	if (!book) throw new Error("Book " + bookTitle + " not found.");

	params.variables["author"] = `[[${book.author}]]`;

	const highlights = (await getHighlightsForElement(book)).results.reverse();
	return writeAllHandler(highlights);
}

async function getDailyQuote(params, settings) {
	useToken(params, settings);
	const category = "supplementals";
	const res = await getHighlightsByCategory(category);
	if (!res) return;

	const { results } = res;
	const targetItem = results[randomNumberInRange(results.length)];

	const { results: highlights } = await getHighlightsForElement(targetItem);
	if (!highlights) return;

	const randomHighlight = highlights[randomNumberInRange(highlights.length)];

	const quote = formatDailyQuote(randomHighlight.text, targetItem);

	return `${quote}`;
}

async function categoryPromptHandler() {
	const choice = await quickAddApi.suggester(
		Object.values(categories),
		Object.keys(categories)
	);
	if (!choice) return null;

	return choice;
}

async function highlightsPromptHandler(highlights) {
	const writeAll = "Write all highlights to page",
		writeOne = "Write one highlight to page";
	const choices = [writeAll, writeOne];

	const choice = await quickAddApi.suggester(choices, choices);
	if (!choice) return null;

	if (choice == writeAll) return writeAllHandler(highlights);
	else return await writeOneHandler(highlights);
}

function writeAllHandler(highlights) {
	return highlights
		.map((hl) => {
			if (hl.text == "No title") return;
			const { quote, note } = textFormatter(hl.text, hl.note);
			return `${quote}${note}`;
		})
		.join("\n\n");
}

async function writeOneHandler(highlights) {
	const chosenHighlight = await quickAddApi.suggester(
		highlights.map((hl) => hl.text),
		highlights
	);
	if (!chosenHighlight) return null;

	const { quote, note } = textFormatter(
		chosenHighlight.text,
		chosenHighlight.note
	);

	return `${quote}${note}`;
}

function formatDailyQuote(sourceText, sourceItem) {
	let quote = sourceText
		.split("\n")
		.filter((line) => line != "")
		.map((line) => {
			return `> ${line}`;
		});

	const attr = `\n>\\- ${sourceItem.author}, _${sourceItem.title}_`;

	return `${quote}${attr}`;
}

function textFormatter(sourceText, rawSourceNote) {
	// Readwise can return a highlight without a note (null/undefined rather
	// than ""); normalize once so the .includes probe below can't throw and
	// abort the whole import on a single note-less highlight.
	const sourceNote = rawSourceNote ?? "";
	let quote = sourceText
		.split("\n")
		.filter((line) => line != "")
		.map((line) => {
			if (sourceNote.includes(".h1")) return `## ${line}`;
			else return `> ${line}`;
		})
		.join("\n");

	let note;

	if (sourceNote.includes(".h1") || sourceNote == "" || !sourceNote) {
		note = "";
	} else {
		note = "\n\n" + sourceNote;
	}

	return { quote, note };
}

async function getHighlightsByCategory(category) {
	return apiGet(`${apiUrl}books`, { category, page_size: 1000 });
}

async function getHighlightsForElement(element) {
	return apiGet(`${apiUrl}highlights`, {
		book_id: element.id,
		page_size: 1000,
	});
}

async function getAllHighlights() {
	const MAX_PAGE_SIZE = 1000;
	const URL = `${apiUrl}highlights`;
	let promises = [];

	const { count } = await apiGet(URL);
	const requestsToMake = Math.ceil(count / MAX_PAGE_SIZE);

	for (let i = 1; i <= requestsToMake; i++) {
		promises.push(apiGet(URL, { page_size: MAX_PAGE_SIZE, page: i }));
	}

	const allHighlights = (await Promise.all(promises)).map((hl) => hl.results);

	return allHighlights;
}

async function apiGet(url, data) {
	let finalURL = new URL(url);
	if (data)
		Object.keys(data).forEach((key) =>
			finalURL.searchParams.append(key, data[key])
		);

	const res = await fetch(finalURL, {
		method: "GET",
		cache: "no-cache",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Token ${token}`,
		},
	});
	if (!res.ok) {
		const hint = res.status === 401 || res.status === 403 ? "check your access token" : "request failed";
		throw new Error(`Readwise API error ${res.status}: ${hint}.`);
	}
	return await res.json();
}
