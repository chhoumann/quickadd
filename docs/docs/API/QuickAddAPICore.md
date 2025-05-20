---
title: QuickAdd API Core
---
# QuickAdd API Core

The API is an interface accessible from scripts, macros and choices.

As of v0.8.0, the API is available for public consumption from just `app.plugins.plugins.quickadd.api`.<br/>
This means you can use the API methods found below in your Dataviewjs scripts, Templater scripts, and so on.

It is also accessible from within [inline scripts](../InlineScripts.md) and [user scripts](../Choices/MacroChoice.md).

### `inputPrompt(header: string, placeholder?: string, value?: string): Promise<string>`
Opens a prompt that asks for an input. Returns a string with the input.

This function is asynchronous. You should ``await`` it.

### `wideInputPrompt: (header: string, placeholder?: string, value?): Promise<string>`
Opens a wide prompt that asks for an input. Returns a string with the input.

This function is asynchronous. You should ``await`` it.

### `yesNoPrompt: (header: string, text?: string): Promise<boolean>`
Opens a prompt asking for confirmation. Returns `true` or `false` based on answer.

This function is asynchronous. You should ``await`` it.

### `infoDialog: (header: string, text: string[] | string): Promise<void>`
Opens a dialog showing the information text and an `OK` button.
You can pass a single string, which results in a single line, or an array of strings, which will be displayed as multiple lines.

This function is asynchronous. You should ``await`` it.

### `suggester: (displayItems: string[] | ((value: string, index?: number, arr?: string[]) => string[]), actualItems: string[]): Promise<string>`
Opens a suggester. Displays the `displayItems`, but you map these the other values with `actualItems`.

The ``displayItems`` can either be an array of strings, or a map function that will be executed on the actual items.

This means that the following syntax is possible:
````js
const pickedFile = await params.quickAddApi.suggester(
    (file) => file.basename,
    params.app.vault.getMarkdownFiles()
);
````

Returns the selected value.

This function is asynchronous. You should ``await`` it.

### `checkboxPrompt: (items: string[], selectedItems: string[]): Promise<string[]>`
Opens a checkbox prompt with the items given. Items in the `selectedItems` array will be selected by default.

Returns an array of the selected items.

This function is asynchronous. You should ``await`` it.

### ``executeChoice(choiceName: string, variables?: {[key: string]: any}): Promise``
Executes choice with the given name.

You can also pass an optional parameter, ``variables``.

The object will be read as variables for the choice to be executed. These variables do _not_ affect the currently set variables.
You should view the execution as a new branch, separate from the one executing the macro.

This function is asynchronous. You should ``await`` it.

#### Example use case for `executeChoice`
Say you have added a [Capture Choice](../Choices/CaptureChoice.md). Now you want to call it from within a script / macro, because you want to execute it repeatedly with different parameters.

Then you'd be able to do something like this:
```js
const massiveDataArray = [/* ... */];
massiveDataArray.forEach(async (data) => {
    await params.quickAddApi.executeChoice('Capture Choice', {
        X: data.x,
        Y: data.y,
        Z: data.z,
        // ...
    });
});
```

This would execute the choice for each item in the array, passing the data as a variable. This means you can access the variables from within your Capture with `{{VALUE:X}}` (and so on, for each key-value pair in the object).

Additionally, you can use the reserved variable name 'value' to pass a value directly to `{{VALUE}}` or `{{NAME}}` format tags:

```js
await params.quickAddApi.executeChoice('My Template Choice', {
    value: "This text will be used for {{VALUE}} tags",
    customVar: "This will be available as {{VALUE:customVar}}"
});
```
