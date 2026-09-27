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
let notice = () => {};

function useToken(params, settings) {
	notice = (message, timeout) => new params.obsidian.Notice(message, timeout);
	token = (settings?.[ACCESS_TOKEN] ?? "").trim();
	if (!token) {
		notice("Set your Readwise access token in the script settings.");
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
		const items = await getHighlightsByCategory(category);
		if (items.length === 0) {
			notice(`Nothing under ${categories[category]} in Readwise yet.`);
			return "";
		}

		const item = await quickAddApi.suggester(
			items.map((item) => item.title),
			items
		);
		if (!item) return;

		params.variables["author"] = `[[${item.author}]]`;

		highlights = (await getHighlightsForElement(item)).reverse();
	}

	if (highlights.length === 0) {
		notice("No highlights there yet.");
		return "";
	}

	const textToAppend = await highlightsPromptHandler(highlights);
	return !textToAppend ? "" : textToAppend;
}

// Use in a file name format: picks a book and returns a name a note can have.
// The book's real title and id are kept in variables for instaFetchBook and
// for {{VALUE:Book Title}} in the template.
async function getBooks(params, settings) {
	useToken(params, settings);
	const books = await getHighlightsByCategory("books");
	if (books.length === 0) {
		notice("No books in Readwise yet.");
		throw new Error("No books in Readwise yet.");
	}

	const book = await params.quickAddApi.suggester(
		books.map((book) => book.title),
		books
	);
	if (!book) throw new Error("No book selected.");

	params.variables["Book Title"] = book.title;
	params.variables["Book Id"] = String(book.id);
	return fileNameFor(book.title);
}

// Obsidian refuses ":" in a name and reads "/" and "\" as folders; Windows also
// refuses * ? " < > |, and [ ] # ^ | would break the [[{{TITLE}}]] link.
function fileNameFor(title) {
	return (
		title
			.replace(/\s*:\s*/g, " - ")
			.replace(/[\\/*?"<>|#^[\]]/g, "")
			.replace(/\s+/g, " ")
			.trim() || "Untitled"
	);
}

async function instaFetchBook(params, settings) {
	useToken(params, settings);
	const bookId = params.variables["Book Id"];
	const bookTitle = params.variables["Book Title"];
	if (!bookId && !bookTitle) return await start(params, settings);

	const books = await getHighlightsByCategory("books");
	// getBooks stored the id, so the lookup is exact. A title set some other way
	// (an older template, a {{VALUE:Book Title}} prompt) matches exactly first,
	// then partially, so "Dune" is not mistaken for "Dune Messiah".
	const wanted = String(bookTitle ?? "").toLowerCase();
	const book =
		books.find((b) => String(b.id) === String(bookId)) ??
		books.find((b) => b.title.toLowerCase() === wanted) ??
		books.find((b) => wanted && b.title.toLowerCase().includes(wanted));
	if (!book) throw new Error("Book " + bookTitle + " not found.");

	params.variables["author"] = `[[${book.author}]]`;

	const highlights = (await getHighlightsForElement(book)).reverse();
	return writeAllHandler(highlights);
}

async function getDailyQuote(params, settings) {
	useToken(params, settings);
	const items = await getHighlightsByCategory("supplementals");
	if (items.length === 0) {
		notice("No supplemental highlights in Readwise yet.");
		return "";
	}
	const targetItem = items[randomNumberInRange(items.length)];

	const highlights = await getHighlightsForElement(targetItem);
	if (highlights.length === 0) {
		notice(`No highlights in ${targetItem.title} yet.`);
		return "";
	}

	const randomHighlight = highlights[randomNumberInRange(highlights.length)];

	return formatDailyQuote(randomHighlight.text, targetItem);
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

	return `${quote.join("\n")}${attr}`;
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

// Readwise lists at most 1000 items per page; these return every page's items.
const PAGE_SIZE = 1000;

async function getHighlightsByCategory(category) {
	return apiGetAll(`${apiUrl}books`, { category, page_size: PAGE_SIZE });
}

async function getHighlightsForElement(element) {
	return apiGetAll(`${apiUrl}highlights`, {
		book_id: element.id,
		page_size: PAGE_SIZE,
	});
}

async function getAllHighlights() {
	return apiGetAll(`${apiUrl}highlights`, { page_size: PAGE_SIZE });
}

// Follows `next` one page at a time: the list endpoints allow 20 requests a
// minute, so fetching pages in parallel would trip the limit on big libraries.
async function apiGetAll(url, data) {
	const results = [];
	let next = withQuery(url, data);
	while (next) {
		const page = await apiGet(next);
		results.push(...page.results);
		next = page.next;
	}
	return results;
}

function withQuery(url, data) {
	const finalURL = new URL(url);
	for (const [key, value] of Object.entries(data ?? {})) {
		finalURL.searchParams.set(key, value);
	}
	return finalURL.toString();
}

async function apiGet(url, data) {
	const finalURL = withQuery(url, data);
	for (let attempt = 1; ; attempt++) {
		const res = await fetch(finalURL, {
			method: "GET",
			cache: "no-cache",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Token ${token}`,
			},
		});
		// Over the rate limit: Readwise says how long to wait, so wait and go again.
		if (res.status === 429 && attempt < 4) {
			const seconds = Number(res.headers.get("Retry-After")) || 60;
			notice(`Readwise rate limit reached, waiting ${seconds} s…`, seconds * 1000);
			await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
			continue;
		}
		if (!res.ok) {
			const hint =
				res.status === 401 || res.status === 403 ? "check your access token"
				: res.status === 429 ? "rate limit reached, try again in a minute"
				: "request failed";
			throw new Error(`Readwise API error ${res.status}: ${hint}.`);
		}
		return await res.json();
	}
}
