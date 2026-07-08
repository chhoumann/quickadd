const notice = (msg) => new Notice(msg, 5000);
const log = (msg) => console.log(msg);

const GOOGLE_BOOKS_API_URL = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_BOOKS_TITLE_TERM = "intitle:"

let QuickAdd;

module.exports =  async function start(params) {
  QuickAdd = params;

  let clipBoardContents = await QuickAdd.quickAddApi.utility.getClipboard();
  const title = await QuickAdd.quickAddApi.inputPrompt(
    "Enter Book title: ", clipBoardContents, clipBoardContents // clipBoardContents is added once as the prompt text and once as the default value
  );
  if (!title) {
    notice("No title entered.");
    throw new Error("No title entered.");
  }

  const encodedTitle = encodeURIComponent(GOOGLE_BOOKS_TITLE_TERM + title);
  const finalURL = GOOGLE_BOOKS_API_URL + "?q=" + encodedTitle + "&maxResults=10";
  const response = await fetch(finalURL);
  const bookDesc = await response.json();

  // The Google Books API omits `items` entirely when a title yields no matches.
  if (!bookDesc.items || bookDesc.items.length === 0) {
    notice("No results found for: " + title);
    throw new Error("No results found for: " + title);
  }

  // In an ideal world we would popup a picker that shows the user: Book Title, Author(s) and cover. They would select the correct version from there
  const book = bookDesc.items[0];
  const volumeInfo = book.volumeInfo;

  QuickAdd.variables = {
    ...book,
    title: volumeInfo.title,
    // How to get mutiple authors or categories out with commas between them
    authors: volumeInfo.authors,
    categories: volumeInfo.categories,
    description: volumeInfo.description,
    fileName: replaceIllegalFileNameCharactersInString(volumeInfo.title),
    // Many valid volumes have no cover, so the imageLinks object can be missing.
    Poster: volumeInfo.imageLinks?.smallThumbnail
  };
}

function replaceIllegalFileNameCharactersInString(string) {
  return string.replace(/[\\,#%&\{\}\/*<>?$\'\":@]*/g, "");
}