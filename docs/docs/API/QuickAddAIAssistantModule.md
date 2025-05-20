---
title: QuickAdd API AI Assistant Module
---
# AI Module
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
