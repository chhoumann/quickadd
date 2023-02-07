# Inline scripts
QuickAdd supports the usage of inline scripts in [Template choices](./Choices/TemplateChoice.md) and [Capture choices](./Choices/CaptureChoice.md).

Inline scripts allow you to execute any JavaScript code you want.
They are parsed and executed before anything else. Accessing of `{{VALUE}}`-Template isn't possible. But you can askk for a Userinput via `this.quickAddApi.inputPrompt`. See [QuickAdd API](./QuickAddAPI.md).

You are given the [QuickAdd API](./QuickAddAPI.md), just as with user scripts. In inline scripts, it is passed in as ``this``, as can be seen in the example below.

````
```js quickadd
const input = await this.quickAddApi.inputPrompt("✍");
return `Input given: ${input}`;
```
````

When you are making an inline script, remember to write ``js quickadd`` and not just ``js`` when denoting the language - otherwise you're just inserting a code snippet.

If you want to insert something, simply ``return`` it. The return type __must__ be a string
