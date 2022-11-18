### Template - My Book Notes template
![OoBBhFGoxl](https://user-images.githubusercontent.com/29108628/122776753-ac7c4d00-d2ab-11eb-9ade-4b88afaee8e4.gif)

#### Installation
Here's a video guide for [installing user scripts in QuickAdd](https://github.com/chhoumann/quickadd/blob/master/docs/Examples/Capture\_FetchTasksFromTodoist.md#installation-video).

Basically, you'll want to create a new JavaScript file (file extension is `.js`) with the contents of the script. Then, in the script, you see the `YOUR_READWISE_TOKEN`, which is where you'll want to insert your Readwise token (find it [here](https://readwise.io/access_token)).

Now you need to create a new macro. To do so, open the Macro Manager, enter a name for it (I use `Readwise`), and then click `Add`. Then click `Configure` on that macro. Once a modal opens, select the user script you've created and click `Add`.

Once that's done, you can use the [template provided below](https://github.com/chhoumann/quickadd/blob/master/docs/Examples/Template_AutomaticBookNotesFromReadwise.md#template). If you have your own, then you can just use the `{{MACRO:Readwise::instaFetchBook}}` to insert the highlights. If you called your macro something else than `Readwise`, replace `Readwise` with that.

This template should be added to a [Template choice](../Choices/TemplateChoice.md), and should be given values that resemble this:
![Template choice setup](../Images/readwise_template_choice.png)

The template path should be the path the template made based on the one here.

Notably, the book's name would be the one selected. I have chosen to write prepend a ``{ `` before it, as I use this to denote literature notes in my vault.

The remaining settings are up to you. Activating this choice will open a menu which allows you to choose a book, and the book notes will be used appended to the template.
You can customize the template as much as you like, but make sure to keep the ``{{MACRO:Readwise::instaFetchBook}}``, as that is what gets the highlights (and where they'll be inserted).


#### Script
Most of the setup is shown in the gif.
```js
module.exports = {start, getDailyQuote, instaFetchBook, getBooks};
const apiUrl = "https://readwise.io/api/v2/";
const books = "📚 Books", articles = "📰 Articles", tweets = "🐤 Tweets", supplementals = "💭 Supplementals", podcasts = "🎙 Podcasts", searchAll = "🔍 Search All Highlights (slow!)";
const categories = {books, articles, tweets, supplementals, podcasts, searchAll};
const randomNumberInRange = (max) => Math.floor(Math.random() * max);
const token = "YOUR_READWISE_TOKEN";
let quickAddApi;

async function start(params) {
    ({quickAddApi} = params);
    let highlights;
    const category = await categoryPromptHandler();
    if (!category) return;

    if (category === "searchAll") {
        highlights = await getAllHighlights(); 
    } else {
        let res = await getHighlightsByCategory(category);
        if (!res) return;

        const {results} = res;
        const item = await quickAddApi.suggester(results.map(item => item.title), results);
        if (!item) return;

        params.variables["author"] = `[[${item.author}]]`;

        const res2 = await getHighlightsForElement(item);
        if (!res2) return;

        highlights  = res2.results.reverse();
    }

    const textToAppend = await highlightsPromptHandler(highlights);
    return !textToAppend ? "" : textToAppend; 
}

async function getBooks(params) {
    const {results: books} = await getHighlightsByCategory("books");
    const bookNames = books.map(book => book.title);
    const selectedBook = await params.quickAddApi.suggester(bookNames, bookNames);
    params.variables["Book Title"] = selectedBook;
    return selectedBook;
}

async function instaFetchBook(params) {
    const bookTitle = params.variables["Book Title"];
    if (!bookTitle) return await start(params);

    const {results: books} = await getHighlightsByCategory("books");
    const book = books.find(b => b.title.toLowerCase().contains(bookTitle.toLowerCase()));
    if (!book) throw new Error("Book " + bookTitle + " not found.");

    params.variables["author"] = `[[${book.author}]]`;

    const highlights = (await getHighlightsForElement(book)).results.reverse();
    return writeAllHandler(highlights);
}

async function getDailyQuote(params) {
    const category = "supplementals";
    const res = await getHighlightsByCategory(category);
    if (!res) return;

    const {results} = res;
    const targetItem = results[randomNumberInRange(results.length)];

    const {results: highlights} = await getHighlightsForElement(targetItem);
    if (!highlights) return;

    const randomHighlight = highlights[randomNumberInRange(highlights.length)];
    
    const quote = formatDailyQuote(randomHighlight.text, targetItem);

    return `${quote}`
}

async function categoryPromptHandler() {
    const choice = await quickAddApi.suggester(Object.values(categories), Object.keys(categories));
    if (!choice) return null;

    return choice;
}

async function highlightsPromptHandler(highlights) {
    const writeAll = "Write all highlights to page", writeOne = "Write one highlight to page";
    const choices = [writeAll, writeOne];

    const choice = await quickAddApi.suggester(choices, choices);
    if (!choice) return null;

    if (choice == writeAll)
        return writeAllHandler(highlights);
    else
        return await writeOneHandler(highlights);
}

function writeAllHandler(highlights) {
    return highlights.map(hl => {
        if (hl.text == "No title") return;
        const {quote, note} = textFormatter(hl.text, hl.note);
        return `${quote}${note}`;
    }).join("\n\n");
}

async function writeOneHandler(highlights) {
    const chosenHighlight = await quickAddApi.suggester(highlights.map(hl => hl.text), highlights);
    if (!chosenHighlight) return null;

    const {quote, note} = textFormatter(chosenHighlight.text, chosenHighlight.note);

    return `${quote}${note}`;
}

function formatDailyQuote(sourceText, sourceItem) {
    let quote = sourceText.split("\n").filter(line => line != "").map(line => {
        return `> ${line}`;
    });

    const attr = `\n>\\- ${sourceItem.author}, _${sourceItem.title}_`;

    return `${quote}${attr}`;
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
    return apiGet(`${apiUrl}books`, {category, "page_size": 1000});
}

async function getHighlightsForElement(element) {
    return apiGet(`${apiUrl}highlights`, {book_id: element.id, page_size: 1000});
}

async function getAllHighlights() {
    const MAX_PAGE_SIZE = 1000;
    const URL = `${apiUrl}highlights`;
    let promises = [];

    const {count} = await apiGet(URL);
    const requestsToMake = Math.ceil(count / MAX_PAGE_SIZE);
    
    for (let i = 1; i <= requestsToMake; i++) {
      promises.push(apiGet(URL, { page_size: MAX_PAGE_SIZE, page: i }));
    }

    const allHighlights = (await Promise.all(promises)).map(hl => hl.results);

    return allHighlights;
}

async function apiGet(url, data) {
    let finalURL = new URL(url);
    if (data)
        Object.keys(data).forEach(key => finalURL.searchParams.append(key, data[key]));
    
    return await fetch(finalURL, {
        method: 'GET', cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Token ${token}`
        },
    }).then(async (res) => await res.json());
}
```
#### Template
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

