# QuickAdd
Quickly add new pages or content to your vault.
### Demo
![zApIWkHrKP](https://user-images.githubusercontent.com/29108628/121762835-bb8b2e80-cb38-11eb-8ef6-b65700526caf.gif)

## Installation
This plugin is not in the community plugin browser in Obsidian (yet).

### Manual Installation
1. Go to [Releases](https://github.com/chhoumann/quickadd/releases) and download the ZIP file from the latest release. The one that looks like `quickadd-x.x.x.zip`.
2. This ZIP file should be extracted in your Obsidian plugins folder. If you don't know where that is, you can go to `Community Plugins` inside Obsidian. There is a folder icon on the right of `Installed Plugins`. Click that and it opens your plugins folder.
3. Extract the contents of the ZIP file there.
4. Now you should have a folder in plugins called 'quickadd' containing a `main.js` file, `manifest.json` file, and a `styles.css` file.

## Getting started
The first thing you'll want to do is add a new choice. A choice can be one of four types.

### Template
The template choice type is not meant to be a replacement for Templater or core Templates. It's meant to augment them. You can use both QuickAdd format syntax in a Templater template - and both will work.
That's one thing. But there's also all the other options: dynamic template names, adding to folders, appending links, incrementing file names, opening the file when it's created (or not), etc.

You first need to specify a _template path_. This is a path to the template you wish to insert.

The remaining settings are useful, but optional. You can specify a format for the file name, which is based on the format syntax - which you can see further down this page.
Basically, this allows you to have dynamic file names. If you wrote `{ {{DATE}} {{NAME}}`, it would translate to a file name like `{ 2021-06-12 FileName`, where `FileName` is a value you enter.

You can specify as many folders as you want. If you don't, it'll just create the file in the root directory. If you specify one folder, it'll create the file in there.
If you specify multiple folders, you'll be asked which folder you wish to create the file in when you are creating it.

_Append link_ appends a link to the created file in the file you're currently in.

_Increment file name_ will, if a file with that name already exists, increment the file name. So if a file called `untitled` already exists, the new file will be called `untitled1`.

_Open_ will open the file you've created. By default, it opens in the active pane. If you enable _New tab_, it'll open in a new tab in the direction you specified.
![image](https://user-images.githubusercontent.com/29108628/121773888-3f680980-cb7f-11eb-919b-97d56ef9268e.png)

### Capture
_Capture To_ is the name of the file you are capturing to. This also supports the format syntax, which allows you to use dynamic file names.
I have one for my daily journal with the name `bins/daily/{{DATE:gggg-MM-DD - ddd MMM D}}.md`. This automatically finds the file for the day, and whatever I enter will be captured to it.

_Prepend_ will put whatever you enter at the bottom of the file.
_Task_ will format it as a task.
_Append link_ will append a link to the file you have open in the file you're capturing to. 
_Insert after_ will allow you to insert the text after some line with the specified text. I use this in my journal capture, where I insert after the line `## What did I do today?`.

_Capture format_ lets you specify the exact format that you want what you're capturing to be inserted as. You can do practically anything here. Think of it as a mini template.
See the format syntax further down on this page for inspiration.
In my journal capture, I have it set to `- {{DATE:HH:mm}} {{VALUE}}`. This inserts a bullet point with the time in hour:minute format, followed by whatever I entered in the prompt.

![image](https://user-images.githubusercontent.com/29108628/121774039-4d6a5a00-cb80-11eb-89be-0aceefaa658b.png)

### Macro
Macros are powerful tools that allow you to execute any sequence of Obsidian commands and user scripts.
User scripts are Javascript scripts that you can write to do something in Obsidian. All you need is a Javascript file in your vault, and you can activate it.

Each _macro choice_ has an associated _macro_. A macro choice allows you to activate a macro from the QuickAdd suggester.

This is what the settings for a _macro choice_ looks like.

![image](https://user-images.githubusercontent.com/29108628/121774145-22ccd100-cb81-11eb-8873-7533755bdf32.png)

Now, you can have any amount of _macros_. You can use the macro manager to... manage them.
If you have any macros that you want to run on plugin load - which is often just when you start Obsidian - you can specify that here, too.

This allows you to, for example, create a daily note automatically when you open Obsidian.

![image](https://user-images.githubusercontent.com/29108628/121774198-81924a80-cb81-11eb-9f80-9816263e4b6f.png)

This is what my `logBook` macro looks like. It's pretty plain - it just executes one of my user scripts.

![image](https://user-images.githubusercontent.com/29108628/121774245-cfa74e00-cb81-11eb-9977-3ddac04dc8bd.png)

The `logBook` user script simply updates the book in my daily page to something I specify in a prompt.
Here it is - with some comments that explain the code. [How-to-install guide](https://github.com/chhoumann/quickadd/issues/15#issuecomment-864553251).

```js
// You have to export the function you wish to run.
// QuickAdd automatically passes a parameter, which is an object with the Obsidian app object
// and the QuickAdd API (see description further on this page).
module.exports = async (params) => {
    // Object destructuring. We pull inputPrompt out of the QuickAdd API in params.
    const {quickAddApi: {inputPrompt}} = params;
    // Here, I pull in the update function from the MetaEdit API.
    const {update} = app.plugins.plugins["metaedit"].api;
    // This opens a prompt with the header "📖 Book Name". val will be whatever you enter.
    const val = await inputPrompt("📖 Book Name");
    // This gets the current date in the specified format.
    const date = window.moment().format("gggg-MM-DD - ddd MMM D");
    // Invoke the MetaEdit update function on the Book property in my daily journal note.
    // It updates the value of Book to the value entered (val).
    await update('Book', val, `bins/daily/${date}.md`)
}
```

Any function executed by QuickAdd will be passed an object as the first (and only) parameter.
The object contains
- A reference to the Obsidian `app`.
- A reference to the QuickAddApi - which allows you to use the functions below.
- A reference to `variables`, an object which, if you assign values to it, you can use in your format syntax.

Let's talk a bit more about `variables`. If you assign a value to a key in `variables`, you can access that variable by its key name.
This can be accessed both in subsequent macros, and the format syntax `{{VALUE:<variable name>}}`.

For example, say you assign `myVar` to `variables`.
Then you can access the value of `myVar` in subsequent macros, as well as through the format syntax`{{VALUE:myVar}}`.
You can also access it through `<parametername>.variables["myVar"]`.

````js
// MACRO 1
module.exports = (params) => {
    params.variables["myVar"] = "test";
}

// MACRO 2
module.exports = (params) => {
    console.log(params.variables["myVar"]);
}
````

You can use variables to pass parameters between user scripts.

In your user scripts for your macros, you can have use ``module.exports`` to export a function, which will be executed as expected.

You can, however, export much more than functions. You can also export variables - and more functions!

````js
// Macro called 'MyMacro'
module.exports = {
    myVar: "test",
    plus: (params) => params.variables["a"] + params.variables["b"],
    start
}

async function start(params) {
    params.app.vault.doSomething();
    const input = await params.quickAddApi.suggester(["DisplayValue1", "DisplayValue2", "DisplayValue3"], ["ActualValue1", "ActualValue2", "ActualValue3"]);
    return input;
}
````

If you select the macro that contains a user script with the above code, you'll be prompted to choose between one of the three exported items.

However, if you want to skip that, you can access nested members using this syntax: `{{MACRO:MyMacro::Start}}`. This will just instantly execute `start`.

### Multi
Multi-choices are pretty simple. They're like folders for other choices. Here are mine. They're the ones which you can 'open' and 'close'.

![image](https://user-images.githubusercontent.com/29108628/121774481-e39f7f80-cb82-11eb-92bf-6d265529ba06.png)

## `format` syntax
| Template                                   | Description                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{{DATE}}`                                 | Outputs the current date in `YYYY-MM-DD` format.                                                                                                                                                                                                                                    |
| `{{DATE:<DATEFORMAT>}}`                    | Replace `<DATEFORMAT>` with a [Moment.js date format](https://momentjs.com/docs/#/displaying/format/).                                                                                                                                                                              |
| `{{VDATE:<variable name>, <date format>}}` | You'll get prompted to enter a date and it'll be parsed to the given date format. You could write 'today' or 'in two weeks' and it'll give you the date for that. Works like variables, so you can use the date in multiple places. **REQUIRES THE NATURAL LANGUAGE DATES PLUGIN!** |
| `{{VALUE}}` or `{{NAME}}`                  | Interchangeable. Represents the value given in an input prompt. If text is selected in the current editor, it will be used as the value.                                                                                                                                             |
| `{{VALUE:<variable name>`                  | You can now use variable names in values. They'll get saved and inserted just like values, but the difference is that you can have as many of them as you want. Use comma separation to get a suggester rather than a prompt.                                                       |
| `{{LINKCURRENT}}`                          | A link to the file from which the template is activated from. `[[link]]` format.                                                                                                                                                                                                    |
| `{{MACRO:<MACRONAME>}}`                    | Execute a macro and get the write the return value here.                                                                                                                                                                                                                            |
| `{{TEMPLATE:<TEMPLATEPATH>}}`              | Include templates in your `format`. Supports Templater syntax.                                                                                                                                                                                                                                                                                    |

## QuickAdd API
### `inputPrompt(header: string, placeholder?: string, value?: string): string`
Opens a prompt that asks for an input. Returns a string with the input.

### `yesNoPrompt: (header: string, text?: string): boolean`
Opens a prompt asking for confirmation. Returns `true` or `false` based on answer.

### `suggester: (displayItems: string[], actualItems: string[])`
Opens a suggester. Displays the `displayItems`, but you map these the other values with `actualItems`.

## Examples
### Capture: Add journal entry
![image](https://user-images.githubusercontent.com/29108628/121774877-c2d82980-cb84-11eb-99c4-a20a14e41856.png)

### Macro: Log book to daily journal
![image](https://user-images.githubusercontent.com/29108628/121774885-d1bedc00-cb84-11eb-9776-d1cdd353e99e.png)
![image](https://user-images.githubusercontent.com/29108628/121774905-ef8c4100-cb84-11eb-9657-b24759096886.png)


```js
// You have to export the function you wish to run.
// QuickAdd automatically passes a parameter, which is an object with the Obsidian app object
// and the QuickAdd API (see description further on this page).
module.exports = async (params) => {
    // Object destructuring. We pull inputPrompt out of the QuickAdd API in params.
    const {quickAddApi: {inputPrompt}} = params;
    // Here, I pull in the update function from the MetaEdit API.
    const {update} = app.plugins.plugins["metaedit"].api;
    // This opens a prompt with the header "📖 Book Name". val will be whatever you enter.
    const val = await inputPrompt("📖 Book Name");
    // This gets the current date in the specified format.
    const date = window.moment().format("gggg-MM-DD - ddd MMM D");
    // Invoke the MetaEdit update function on the Book property in my daily journal note.
    // It updates the value of Book to the value entered (val).
    await update('Book', val, `bins/daily/${date}.md`)
}
```

### Template: Add an Inbox Item
![image](https://user-images.githubusercontent.com/29108628/121774925-fe72f380-cb84-11eb-8a4f-fd654d2d8c25.png)

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

### Template - My Book Notes template
![OoBBhFGoxl](https://user-images.githubusercontent.com/29108628/122776753-ac7c4d00-d2ab-11eb-9ade-4b88afaee8e4.gif)

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


### Bonus - Open QuickAdd from your Desktop
This is an AutoHotkey script which unminimizes/focuses Obsidian and sends some keypresses.

```ahk
#SingleInstance, Force
SendMode Input
SetWorkingDir, %A_ScriptDir%
SetTitleMatchMode, RegEx

!^+g::
    WinActivate, i) Obsidian
    ControlSend,, {CtrlDown}{AltDown}{ShiftDown}G{CtrlUp}{CtrlUp}{ShiftUp}, i)Obsidian
Return
```
I'm using CTRL+SHIFT+ALT+G as my shortcut, both in Obsidian and for the AHK script to activate. I use a keyboard shortcut to send those keys (lol, I know - but it's to avoid potential conflicts).
Here's a guide to what the `!^+` mean, and how you can customize it: https://www.autohotkey.com/docs/Hotkeys.htm
