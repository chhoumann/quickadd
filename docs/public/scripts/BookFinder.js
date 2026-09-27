const notice = (msg) => new Notice(msg, 5000);
const log = (msg) => console.log(msg);

const GOOGLE_BOOKS_API_URL = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_BOOKS_TITLE_TERM = "intitle:"

let QuickAdd;

module.exports =  async function start(params) {
  QuickAdd = params;

  // Prefill the prompt from the clipboard when it looks like a title, not when it
  // holds something long or multi-line such as a pasted article or a package.
  const clipBoardContents = String((await QuickAdd.quickAddApi.utility.getClipboard().catch(() => "")) ?? "").trim();
  const prefill = clipBoardContents.length <= 120 && !clipBoardContents.includes("\n") ? clipBoardContents : "";
  const title = await QuickAdd.quickAddApi.inputPrompt(
    "Enter Book title: ", prefill, prefill // prefill is added once as the placeholder and once as the default value
  );
  if (!title) {
    notice("No title entered.");
    throw new Error("No title entered.");
  }

  const encodedTitle = encodeURIComponent(GOOGLE_BOOKS_TITLE_TERM + title);
  const finalURL = GOOGLE_BOOKS_API_URL + "?q=" + encodedTitle + "&maxResults=10";
  const response = await fetch(finalURL);
  // A proxy or outage can answer with an HTML error page rather than JSON.
  const bookDesc = await response.json().catch(() => ({}));

  // Keyless requests share a per-network daily quota, so a 429 here is not "no results".
  if (!response.ok || bookDesc.error) {
    const reason = bookDesc.error?.message ?? `HTTP ${response.status}`;
    notice("Google Books request failed: " + reason);
    throw new Error("Google Books request failed: " + reason);
  }

  // The Google Books API omits `items` entirely when a title yields no matches.
  if (!bookDesc.items || bookDesc.items.length === 0) {
    notice("No results found for: " + title);
    throw new Error("No results found for: " + title);
  }

  // In an ideal world we would popup a picker that shows the user: Book Title, Author(s) and cover. They would select the correct version from there
  const book = bookDesc.items[0];
  const volumeInfo = book.volumeInfo;

  // Authors, categories, description and cover are all optional in the API.
  // QuickAdd treats an undefined variable as "not answered yet" and would prompt
  // for it, so fall back to an empty value instead.
  QuickAdd.variables = {
    ...book,
    title: volumeInfo.title,
    // How to get mutiple authors or categories out with commas between them
    authors: volumeInfo.authors ?? "",
    categories: volumeInfo.categories ?? "",
    description: volumeInfo.description ?? "",
    fileName: replaceIllegalFileNameCharactersInString(volumeInfo.title),
    Poster: volumeInfo.imageLinks?.smallThumbnail ?? ""
  };
}

function replaceIllegalFileNameCharactersInString(string) {
  return string.replace(/[\\,#%&\{\}\/*<>?$\'\":@]*/g, "");
}