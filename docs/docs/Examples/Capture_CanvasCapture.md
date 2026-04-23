---
title: "Capture: Canvas Capture"
---

Canvas capture lets a Capture choice write into a selected Canvas card or into a
specific card in a specific `.canvas` file.

## When to use this

Use Canvas capture when your workflow starts in a visual board, but you still
want QuickAdd's capture formats, variables, and hotkeys.

Good fits:

- Add a timestamped note to a selected brainstorming card.
- Append a task to a project card.
- Send repeated updates to one known Canvas card.

## Capture to the selected card

1. Create a Capture choice.
2. Enable **Capture to active file**.
3. Open a Canvas file.
4. Select exactly one supported card.
5. Set **Write position** to **Top of file**, **Bottom of file**, or
   **After line...**.
6. Run the Capture choice.

Supported selected-card targets:

- Text cards
- File cards that point to Markdown files

QuickAdd aborts with a notice if no card is selected, multiple cards are
selected, or the selected card is unsupported.

## Capture to a specific card

1. Create a Capture choice.
2. Turn off **Capture to active file**.
3. Set **Capture To** to a `.canvas` file.
4. Choose **Target canvas node**.
5. Pick the card you want QuickAdd to write to.
6. Set a supported write position.

This is the best option for repeatable workflows where every capture should go
to the same Canvas card.

## Write position support

Canvas capture supports these write positions:

- **Top of file**
- **Bottom of file**
- **After line...**

Canvas capture does not support cursor-based write positions:

- **At cursor**
- **New line above cursor**
- **New line below cursor**

If **Capture to active file** is enabled and the write position is still
**At cursor**, QuickAdd aborts instead of writing to the wrong place.

## Append-link behavior

When append-link is set to **Enabled (requires active file)** and capture runs
from a Canvas card without a focused Markdown editor, the capture still writes.
QuickAdd skips link insertion because there is no active Markdown file to link
from.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Capture aborts before writing | No card or multiple cards are selected | Select exactly one supported card |
| Capture aborts with cursor-position wording | The write mode is cursor-based | Use top, bottom, or after-line placement |
| Nothing is written to a file card | The file card points to a non-Markdown file | Use a Markdown file card or a text card |
| The target picker is not shown | Capture target is not a `.canvas` file | Set **Capture To** to the Canvas file path |

## Related docs

- [Capture Choices](../Choices/CaptureChoice)
- [Format Syntax](../FormatSyntax)
- [Template: Create an MOC Note with a Link Dashboard](./Template_CreateMOCNoteWithLinkDashboard)
