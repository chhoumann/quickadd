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

  // In an ideal world we would popup a picker that shows the user: Book Title, Author(s) and cover. They would select the correct version from there

  QuickAdd.variables = {
    ...bookDesc.items[0],
    title: bookDesc.items[0].volumeInfo.title,
    // How to get mutiple authors or categories out with commas between them
    authors: bookDesc.items[0].volumeInfo.authors,
    categories: bookDesc.items[0].volumeInfo.categories,
    description: bookDesc.items[0].volumeInfo.description,
    fileName: replaceIllegalFileNameCharactersInString(bookDesc.items[0].volumeInfo.title),
    Poster:bookDesc.items[0].volumeInfo.imageLinks.smallThumbnail
  };
}

function replaceIllegalFileNameCharactersInString(string) {
  return string.replace(/[\\,#%&\{\}\/*<>?$\'\":@]*/g, "");
}