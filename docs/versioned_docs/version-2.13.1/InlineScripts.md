# Inline scripts
QuickAdd supports the usage of inline scripts in [Template choices](./Choices/TemplateChoice.md) and [Capture choices](./Choices/CaptureChoice.md).

Inline scripts allow you to execute any JavaScript code you want.

You are given the [QuickAdd API](./QuickAddAPI.md), just as with user scripts. In inline scripts, it is passed in as ``this``, as can be seen in the example below.

````
```js quickadd
const input = await this.quickAddApi.inputPrompt("✍");
return `Input given: ${input}`;
```
````

When you are making an inline script, remember to write ``js quickadd`` and not just ``js`` when denoting the language - otherwise you're just inserting a code snippet.

If you want to insert something, simply ``return`` it. The return type __must__ be a string.

## Execution order and `{{VALUE}}`

Inline scripts execute before unnamed formatter tokens such as `{{VALUE}}`
and `{{NAME}}` are substituted in the surrounding template output.

Because of this, code like `let v = "{{VALUE}}"` treats `{{VALUE}}` as
literal text inside JavaScript. If you mutate `v`, you are mutating token text,
not the selected/prompted value.

When you need input-aware logic in inline scripts, fetch input directly through
the QuickAdd API and work on that value:

````
```js quickadd
const raw = await this.quickAddApi.inputPrompt("Text");
if (!raw) return "";

const transformed = raw.toUpperCase();
this.variables.value = transformed; // optional handoff to formatter variables

return transformed;
```
````

### Example: convert phone text to a `tel:` link

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
