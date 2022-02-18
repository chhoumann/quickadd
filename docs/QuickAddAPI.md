# QuickAdd API
### `inputPrompt(header: string, placeholder?: string, value?: string): string`
Opens a prompt that asks for an input. Returns a string with the input.

This function is asynchronous. You should ``await`` it.

### `wideInputPrompt: (header: string, placeholder?: string, value?: string)`
Opens a wide prompt that asks for an input. Returns a string with the input.

This function is asynchronous. You should ``await`` it.

### `yesNoPrompt: (header: string, text?: string): boolean`
Opens a prompt asking for confirmation. Returns `true` or `false` based on answer.

This function is asynchronous. You should ``await`` it.

### `suggester: (displayItems: string[] | ((value: string, index?: number, arr?: string[]) => string[]), actualItems: string[])`
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

### `checkboxPrompt: (items: string[], selectedItems: string[])`
Opens a checkbox prompt with the items given. Items in the `selectedItems` array will be selected by default.

Returns an array of the selected items.

This function is asynchronous. You should ``await`` it.

### ``executeChoice(choiceName: string, variables?: {[key: string]: any})``
Executes choice with the given name.

You can also pass an optional parameter, ``variables``.

The object will be read as variables for the choice to be executed. These variables do _not_ affect the currently set variables.
You should view the execution as a new branch, separate from the one executing the macro.

This function is asynchronous. You should ``await`` it.

#### Example use case for `executeChoice`
Say you have added a [Capture Choice](./Choices/CaptureChoice.md). Now you want to call it from within a script / macro, because you want to execute it repeatedly with different parameters.

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

## Utility module
### ``getClipboard()``
Returns the contents of your clipboard.

This function is asynchronous. You should ``await`` it.

Syntax: `await quickAddApi.utility.getClipboard();`

### ``setClipboard(text: string)``
Sets the contents of your clipboard to the given input.

This function is asynchronous. You should ``await`` it.

Syntax: `await quickAddApi.utility.setClipboard();`

## Date module
Formats always default to ``YYYY-MM-DD``.
### ``now(format?: string, offset?: number)``
Gets the current time and formats according to the given format.

Providing an offset will offset the date by number of days. Giving -1 would mean yesterday, and giving 1 would mean tomorrow - and so on.

### ``tomorrow(format?: string)``
Same as ``now`` but with offset set to 1.

### ``yesterday(format?: string)``
Again, same as ``now`` but with offset set to -1.

## Obsidian
The Obsidian API is exposed as well.
Accessible through the first parameter in your scripts. For example:
````js
module.exports = ({obsidian}) => {
    // obsidian is the API
}
````