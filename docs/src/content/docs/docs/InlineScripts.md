---
title: Inline scripts
description: Run JavaScript inside Template and Capture choices with js quickadd code blocks, returning a string to be inserted
slug: docs/InlineScripts
---

An inline script is a small block of JavaScript you drop straight into a
[Template](/docs/Choices/TemplateChoice/) or
[Capture](/docs/Choices/CaptureChoice/) choice. When the choice runs, QuickAdd
runs your code and inserts whatever it returns, so you can compute the text
instead of typing it. Reach for one when a [placeholder](/docs/FormatSyntax/)
isn't enough: you need to transform what you typed, look something up, or build
text with a bit of logic.

## Write your first inline script {#write-your-first-inline-script}

Put a `js quickadd` code block anywhere in a template or capture format.
Whatever the script returns takes its place:

````
```js quickadd
const input = await this.quickAddApi.inputPrompt("✍");
return `Input given: ${input}`;
```
````

QuickAdd asks you for text, and inserts `Input given:` followed by whatever you
typed.

Good to know:

- Label the block `js quickadd`, not plain `js`. A plain `js` block is inserted as an ordinary code snippet and never runs.
- The [QuickAdd API](/docs/QuickAddAPI/) is available as `this` (the same API user scripts get, where it arrives as a parameter instead).
- To insert something, `return` it. The return value **must** be a string.

## Execution order and `{{VALUE}}` {#execution-order-and-value}

Inline scripts run *before* QuickAdd fills in unnamed placeholders like
`{{VALUE}}` and `{{NAME}}` in the surrounding output.

So if you write `let v = "{{VALUE}}"`, the script sees the literal text
`{{VALUE}}`, not your answer. Changing `v` changes that literal text, not the
value QuickAdd substitutes elsewhere.

When your script needs the real input, ask for it directly through the API and
work with what you get back:

````
```js quickadd
const raw = await this.quickAddApi.inputPrompt("Text");
if (!raw) return "";

const transformed = raw.toUpperCase();
this.variables.value = transformed; // optional handoff to formatter variables

return transformed;
```
````

Assigning `this.variables.value` hands the result back to the surrounding
format, so a later `{{VALUE}}` picks it up.

### Example: convert phone text to a `tel:` link {#example-convert-phone-text-to-a-tel-link}

This script asks for a phone number, strips out spaces and punctuation, turns
any letters into their dial-pad digits, and returns a Markdown link:

````
```js quickadd
function convertPhoneNumberToLink(linkNumber) {
	linkNumber = linkNumber.replace(/[^a-zA-Z0-9+]/g, "");
	linkNumber = linkNumber.replace(/[ABCabc]/g, "2");
	linkNumber = linkNumber.replace(/[DEFdef]/g, "3");
	linkNumber = linkNumber.replace(/[GHIghi]/g, "4");
	linkNumber = linkNumber.replace(/[JKLjkl]/g, "5");
	linkNumber = linkNumber.replace(/[MNOmno]/g, "6");
	linkNumber = linkNumber.replace(/[PQRSpqrs]/g, "7");
	linkNumber = linkNumber.replace(/[TUVtuv]/g, "8");
	linkNumber = linkNumber.replace(/[WXYZwxyz]/g, "9");
	return `tel:${linkNumber}`;
}

const raw = await this.quickAddApi.inputPrompt("Phone number");
if (!raw) return "";

return `[${raw}](${convertPhoneNumberToLink(raw)})`;
```
````

Type `1-800-FLOWERS` and you get `[1-800-FLOWERS](tel:18003569377)`.
