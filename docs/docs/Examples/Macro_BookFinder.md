---
title: Book Finder Script
---

This script allows you to easily insert the details of a book into your vault.

We use Google books api to get the the details. You don't need an API key because we're only exploring publicly available information.


## Installation

We'll need to install a QuickAdd BookFinder script for this to work.
You will need to put the user script into a new macro and then create a Macro choice in the main menu to activate it.
You can find the script [here](./Attachments/BookFinder.js).

1. Save the script (`BookFinder.js`) to your vault somewhere. Make sure it is saved as a JavaScript file, meaning that it has the `.js` at the end.
2. Create a new template in your designated templates folder. Example template is provided below.
3. Open the Macro Manager by opening the QuickAdd plugin settings and clicking `Manage Macros`.
4. Create a new Macro - you decide what to name it. I named mine `BookFinder`.
5. Add the user script to the command list.
6. Add a new Template step to the macro. This will be what creates the note in your vault. Settings are as follows:
    1. Set the template path to the template you created.
    2. Enable File Name Format and use `{{VALUE:fileName}}` as the file name format. You can specify this however you like. The `fileName` value is the name of the Book without illegal file name characters.
    3. The remaining settings are for you to specify depending on your needs.
7. Go back out to your QuickAdd main menu and add a new Macro choice. Again, you decide the name. I named mine `Book`. This is what activates the macro.
8. Attach the Macro to the Macro Choice you just created. Do so by clicking the cog ⚙ icon and selecting it.

You can now use the macro to create notes with book information in your vault.

### Example template

```markdown
![poster]({{VALUE:Poster}})

**Author**:: {{VALUE:authors}}
**Title**:: {{VALUE:title}}
**Category**::{{VALUE:categories}}
**Status**:: 📥

**Related Books**
### Core Questions for Me

### Actions

### My Notes

## Details
{{VALUE:description}}
```

## Usage

It's possible to access whichever JSON variables are sent in response through a `{{VALUE:<variable>}}` tag (e.g. `{{VALUE:Title}}`). Below is an example response for the Book 'Flowers for Algernon'.
**From personal experience this JSON is messy enough that we might want encourage people to extend the JS code to extract additional info**

```json
{
  "kind": "books#volumes",
  "totalItems": 119,
  "items": [
    {
      "kind": "books#volume",
      "id": "6P_jN6zUuMcC",
      "etag": "FpDPG4koVaQ",
      "selfLink": "https://www.googleapis.com/books/v1/volumes/6P_jN6zUuMcC",
      "volumeInfo": {
        "title": "Flowers for Algernon",
        "authors": [
          "Daniel Keyes"
        ],
        "publisher": "Houghton Mifflin Harcourt",
        "publishedDate": "2004",
        "description": "Oscar-winning film Charly starring Cliff Robertson and Claire Bloom-a mentally challenged man receives an operation that turns him into a genius...and introduces him to heartache.",
        "industryIdentifiers": [
          {
            "type": "ISBN_13",
            "identifier": "9780156030083"
          },
          {
            "type": "ISBN_10",
            "identifier": "015603008X"
          }
        ],
        "readingModes": {
          "text": false,
          "image": true
        },
        "pageCount": 324,
        "printType": "BOOK",
        "categories": [
          "Fiction"
        ],
        "averageRating": 4,
        "ratingsCount": 179,
        "maturityRating": "NOT_MATURE",
        "allowAnonLogging": true,
        "contentVersion": "1.3.3.0.preview.1",
        "panelizationSummary": {
          "containsEpubBubbles": false,
          "containsImageBubbles": false
        },
        "imageLinks": {
          "smallThumbnail": "http://books.google.com/books/content?id=6P_jN6zUuMcC&printsec=frontcover&img=1&zoom=5&edge=curl&source=gbs_api",
          "thumbnail": "http://books.google.com/books/content?id=6P_jN6zUuMcC&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api"
        },
        "language": "en",
        "previewLink": "http://books.google.ca/books?id=6P_jN6zUuMcC&printsec=frontcover&dq=intitle:Flowers+for+Algernon&hl=&cd=1&source=gbs_api",
        "infoLink": "http://books.google.ca/books?id=6P_jN6zUuMcC&dq=intitle:Flowers+for+Algernon&hl=&source=gbs_api",
        "canonicalVolumeLink": "https://books.google.com/books/about/Flowers_for_Algernon.html?hl=&id=6P_jN6zUuMcC"
      },
      "saleInfo": {
        "country": "CA",
        "saleability": "NOT_FOR_SALE",
        "isEbook": false
      },
      "accessInfo": {
        "country": "CA",
        "viewability": "PARTIAL",
        "embeddable": true,
        "publicDomain": false,
        "textToSpeechPermission": "ALLOWED",
        "epub": {
          "isAvailable": false
        },
        "pdf": {
          "isAvailable": true,
          "acsTokenLink": "http://books.google.ca/books/download/Flowers_for_Algernon-sample-pdf.acsm?id=6P_jN6zUuMcC&format=pdf&output=acs4_fulfillment_token&dl_type=sample&source=gbs_api"
        },
        "webReaderLink": "http://play.google.com/books/reader?id=6P_jN6zUuMcC&hl=&source=gbs_api",
        "accessViewStatus": "SAMPLE",
        "quoteSharingAllowed": false
      },
      "searchInfo": {
        "textSnippet": "WINNER OF THE HUGO AWARD AND THE NEBULA AWARD The classic novel that inspired the Academy Award-winning movie Charly Daniel Keyes, the author of eight books, was born in Brooklyn, New York, and received his B.A. and M.A. degrees from ..."
      }
    },
```
