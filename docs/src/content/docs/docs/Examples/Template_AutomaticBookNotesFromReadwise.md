---
title: "Template - My Book Notes template"
description: Pull a book's highlights from Readwise into a new note using a Template choice and a bundled highlight-fetching macro
slug: docs/Examples/Template_AutomaticBookNotesFromReadwise
---

This example creates a new book note from a template and fills in a book's highlights straight from [Readwise](https://readwise.io). When you run it, you pick a book, and QuickAdd builds a note whose body already contains that book's highlights and notes.

![OoBBhFGoxl](https://user-images.githubusercontent.com/29108628/122776753-ac7c4d00-d2ab-11eb-9ade-4b88afaee8e4.gif)

## Before you start

- A Readwise account and its access token. Get your token [here](https://readwise.io/access_token).
- The sample template's title and date lines (`<% ... %>`) are [Templater](https://github.com/SilentVoid13/Templater) syntax, so you need the Templater plugin for those to render. Every QuickAdd placeholder uses `{{ ... }}` instead.

## Installation

Here's a video guide for [installing user scripts in QuickAdd](/docs/Examples/Capture_FetchTasksFromTodoist/#installation-video).

1. Create a new JavaScript file (with the `.js` extension) containing the [script below](#script). In it, replace `YOUR_READWISE_TOKEN` with your own Readwise token.
2. Create the macro that runs the script: open QuickAdd's settings, click **New choice**, and select **Macro**. Name it (I use `Readwise`), then click the configure button (the gear icon) to open the Macro Builder. See [the Macro choice docs](/docs/Choices/MacroChoice/) for a full walkthrough.
3. In the builder, add a **User Script** command: type the name of the script you created (or click **Browse**) and click **Add**.
4. Create a [Template choice](/docs/Choices/TemplateChoice/) whose **Template Path** points at the template you made from the [one below](#template). Set the remaining options to your liking. The screenshot shows settings resembling mine:

![Template choice setup](../Images/readwise_template_choice.png)

A few notes on how it behaves:

- The note is named after the book you select. I prepend a `{ ` to that name, because I use it to denote literature notes in my vault.
- Running the choice opens a menu to choose a book, and the highlights are appended into the template where the macro placeholder sits.
- Customize the template however you like, but keep `{{MACRO:Readwise::instaFetchBook}}` - that placeholder is what fetches the highlights and marks where they are inserted. If you named your macro something other than `Readwise`, replace `Readwise` in that placeholder with your macro's name.

## Script

Most of the setup is shown in the gif.

```js
module.exports = { start, getDailyQuote, instaFetchBook, getBooks };
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
const token = "YOUR_READWISE_TOKEN";
let quickAddApi;

async function start(params) {
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

async function getBooks(params) {
	const { results: books } = await getHighlightsByCategory("books");
	const bookNames = books.map((book) => book.title);
	const selectedBook = await params.quickAddApi.suggester(
		bookNames,
		bookNames
	);
	params.variables["Book Title"] = selectedBook;
	return selectedBook;
}

async function instaFetchBook(params) {
	const bookTitle = params.variables["Book Title"];
	if (!bookTitle) return await start(params);

	const { results: books } = await getHighlightsByCategory("books");
	const book = books.find((b) =>
		b.title.toLowerCase().contains(bookTitle.toLowerCase())
	);
	if (!book) throw new Error("Book " + bookTitle + " not found.");

	params.variables["author"] = `[[${book.author}]]`;

	const highlights = (await getHighlightsForElement(book)).results.reverse();
	return writeAllHandler(highlights);
}

async function getDailyQuote(params) {
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

	return await fetch(finalURL, {
		method: "GET",
		cache: "no-cache",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Token ${token}`,
		},
	}).then(async (res) => await res.json());
}
```

## Template

```md
---
image:
tags: in/books
aliases:
    - <% tp.file.title.replace('{ ', '') %>
cssclass:
---

# Title: [[<%tp.file.title%>]]

## Metadata

Tags::
Type:: [[{]]
Author:: {{VALUE:author}}
Reference::
Rating::
Reviewed Date:: [[<%tp.date.now("gggg-MM-DD - ddd MMM D")%>]]
Finished Year:: [[<%tp.date.now("gggg")%>]]

# Thoughts

# Actions Taken / Changes

# Summary of Key Points

# Highlights & Notes

{{MACRO:Readwise::instaFetchBook}}
```
