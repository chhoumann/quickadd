# QuickAdd API

The API is an interface accessible from scripts, macros and choices.

As of v0.8.0, the API is available for public consumption from just `app.plugins.plugins.quickadd.api`.<br/>
This means you can use the API methods found below in your Dataviewjs scripts, Templater scripts, and so on.

It is also accessible from within [inline scripts](./InlineScripts.md) and [user scripts](./Choices/MacroChoice.md).

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
Opens a dialog showing information the text and an `OK` button.
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
Given by `api.utility`.

### ``getClipboard(): Promise<string>``
Returns the contents of your clipboard.

This function is asynchronous. You should ``await`` it.

Syntax: `await quickAddApi.utility.getClipboard();`

### ``setClipboard(text: string): Promise``
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

## AI Module
Given by `api.ai`.

### `prompt(prompt: string, model: Model, settings?: Partial<{variableName: string, shouldAssignVariables: boolean, modelOptions: Partial<OpenAIModelParameters>, showAssistantMessages: boolean, systemPrompt: string}>): Promise<{[key: string]: string}>`

This function is a part of the AI module and it takes a prompt and a Large Language Model (LLM) to perform an action and return the result. The optional settings parameter is used to control the function's behavior. 

This function is asynchronous. You should `await` it.

The parameters of the function are as follows:

- `prompt`: A `string`. The prompt that will be passed to the machine learning model.
- `model`: A `Model`. The machine learning model that will process the prompt. The model could be "gpt-3.5-turbo", "gpt-3.5-turbo-16k", "gpt-4", "gpt-4-32k", or "text-davinci-003".
- `settings`: An optional `object` with the following keys:
    - `variableName`: A `string`. The name of the output variable. Default is "output".
    - `shouldAssignVariables`: A `boolean`. If set to true, the result of the function will be assigned to the variables of the `choiceExecutor`. Default is `false`.
    - `modelOptions`: An instance of `Partial<OpenAIModelParameters>`. The parameters to be used when interacting with the OpenAI model. Defaults to an empty object.
    - `showAssistantMessages`: A `boolean`. If set to true, messages from the assistant will be shown. Default is `true`.
    - `systemPrompt`: A `string`. The system prompt to be used. Default is your default system prompt, as specified in the AI Assistant settings.

Returns a `Promise` that resolves to the result of the `Prompt` function call. That is an object with the following keys:
- `output` or your specified `variableName`: A `string`. The output of the machine learning model. 
- `output-quoted` or your specified `variableName` + `-quoted`: A `string`. The output of the machine learning model, but in a markdown quote.

#### Example use case for `ai.prompt`

```js
const promptText = "What is the capital of France?";
const model = "gpt-4";

const settings = {
    variableName: "capital",
    shouldAssignVariables: true,
    modelOptions: {
        temperature: 0.6,
        max_tokens: 60,
        frequency_penalty: 0.5,
        presence_penalty: 0.5
    },
    showAssistantMessages: true,
    systemPrompt: "Please provide the answer"
};

const response = await api.ai.prompt(promptText, model, settings);
```

In this example, the function will ask the GPT-4 model "What is the capital of France?". The response from the model will be assigned to the variable "capital". The model parameters will be set to a temperature of 0.6, maximum of 60 tokens, frequency penalty of 0.5, and presence penalty of 0.5. Assistant messages will be shown, and the system prompt will be "Please provide the answer".

An example response is:

```json
{
    "capital": "The capital of France is [[Paris]].",
    "capital-quoted": "> The capital of France is [[Paris]]."
}
```

### `getModels(): Model[]`

Returns an array containing the names of all available LLMs. 

This function is synchronous.

#### Example use case for `ai.getModels`

```js
const models = api.ai.getModels();
console.log(models); // Outputs: ["gpt-3.5-turbo", "gpt-3.5-turbo-16k", "gpt-4", "gpt-4-32k", "text-davinci-003"]
```

In this example, the function will return all the available LLMs.

### `getMaxTokens(model: Model): number`

Returns the maximum number of tokens that the specified model can handle.

This function is synchronous.

- `model`: A `Model`. The LLM for which the maximum token limit will be returned.

#### Example use case for `ai.getMaxTokens`

```js
const model = "gpt-4";
const maxTokens = api.ai.getMaxTokens(model);
console.log(maxTokens); // Outputs: Max token limit for the specified model
```

In this example, the function will return the maximum token limit for the GPT-4 model.

### `countTokens(text: string, model: Model): number`

Counts the number of tokens in the provided text string according to the tokenization rules of the specified model.

This function is synchronous.

- `text`: A `string`. The text for which the token count will be computed.
- `model`: A `Model`. The LLM whose tokenization rules will be used.

#### Example use case for `ai.countTokens`

```js
const model = "gpt-4";
const text = "This is a sample sentence.";
const tokenCount = api.ai.countTokens(text, model);
console.log(tokenCount); // Outputs: Token count for the specified sentence
```

In this example, the function will return the token count for the text "This is a sample sentence." according to the GPT-4 model's tokenization rules.

## Obsidian
The Obsidian API is exposed as well.
Accessible through the first parameter in your scripts. For example:
````js
module.exports = ({obsidian}) => {
    // obsidian is the API
}
````