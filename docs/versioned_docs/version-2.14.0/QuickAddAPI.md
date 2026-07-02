# QuickAdd API

The QuickAdd API provides a powerful interface for automating tasks in Obsidian through scripts, macros, and inline scripts. The API offers methods for user interaction, file manipulation, AI integration, and more.

:::tip Start with the overview

If you are choosing which API surface to use, read the
[API Overview](./Advanced/APIOverview) first. This page is the full reference.

:::

## Accessing the API

The API can be accessed in several ways:

### From QuickAdd Scripts (Macros/User Scripts)
```javascript
module.exports = async (params) => {
    const { quickAddApi, app, variables } = params;
    // Use quickAddApi here
};
```

### From Other Plugins/Scripts
```javascript
const quickAddApi = app.plugins.plugins.quickadd.api;
// Use the API methods
```

### From Templater Scripts
```javascript
<%*
const quickAddApi = app.plugins.plugins.quickadd.api;
const result = await quickAddApi.inputPrompt("Enter value:");
tR += result;
%>
```


## User Input Methods

### `requestInputs(inputs: Array<{ id: string; label?: string; type: "text" | "number" | "textarea" | "dropdown" | "date" | "field-suggest" | "suggester" | "slider"; placeholder?: string; defaultValue?: string; numericConfig?: { min?: number; max?: number; step?: number }; sliderConfig?: { min: number; max: number; step?: number }; options?: string[]; dateFormat?: string; description?: string; optional?: boolean; suggesterConfig?: { allowCustomInput?: boolean; caseSensitive?: boolean; multiSelect?: boolean; } }>): Promise<Record<string, string>>`
Opens a one-page modal to collect multiple inputs in one go. Values already present in `variables` are used and not re-asked. Returned values are also stored into `variables`.

**Behavior:**
- Uses existing values for any ids that already exist in `variables` (including empty strings).
- Prompts only for missing (`undefined`/`null`) inputs.
- If the user closes the modal without submitting, the promise rejects with `MacroAbortError("Input cancelled by user")`.

**Field Types:**
- `text`: Single-line text input
- `number`: Numeric input, optionally bounded by `numericConfig`
- `textarea`: Multi-line text input
- `dropdown`: Fixed dropdown menu (no search, must select from list)
- `date`: Date input with natural language support (short aliases like `t`, `tm`, `yd` are supported and configurable in settings)
- `field-suggest`: Vault field suggestions (uses `{{FIELD:...}}` syntax)
- `slider`: Bounded numeric input with a slider and editable number field. Requires `sliderConfig.min` and `sliderConfig.max`; `sliderConfig.step` defaults to `1`. Invalid slider configs fall back to `number`.
- `suggester`: **NEW** - Searchable autocomplete with custom options (allows custom input)
  - Supports multi-select mode via `suggesterConfig.multiSelect: true` for comma-separated selections

`requestInputs` always returns text values in a `Record<string, string>`. For a multi-select suggester input, the selected items are stored as one comma-separated string, not as selected record objects.

**Example:**
```javascript
const values = await quickAddApi.requestInputs([
  { id: "project", label: "Project", type: "text", defaultValue: "Inbox" },
  { id: "due", label: "Due", type: "date", dateFormat: "YYYY-MM-DD" },
  { id: "confidence", label: "Confidence", type: "slider", defaultValue: "50", sliderConfig: { min: 0, max: 100, step: 5 } },
  { id: "status", label: "Status", type: "dropdown", options: ["Todo","Doing","Done"] },
  { 
    id: "tags", 
    label: "Tags", 
    type: "suggester", 
    options: ["work", "personal", "urgent", "review"],
    placeholder: "Type to search tags...",
    suggesterConfig: { caseSensitive: false }
  }
]);
```

**Suggester with Dynamic Options (e.g., from Dataview):**
```javascript
// Get dynamic options from Dataview
const dv = app.plugins.plugins.dataview?.api;
const projectNames = dv?.pages()
  .where(p => p.type === "project")
  .map(p => p.file.name)
  .array() ?? ["Inbox"];

const values = await quickAddApi.requestInputs([
  {
    id: "project",
    label: "Select Project",
    type: "suggester",
    options: projectNames,
    placeholder: "Start typing project name..."
  }
]);
```

**Multi-Select Suggester:**
```javascript
// Select multiple tags, comma-separated
const values = await quickAddApi.requestInputs([
  {
    id: "tags",
    label: "Select Tags",
    type: "suggester",
    options: ["#work", "#personal", "#project", "#urgent", "#review"],
    suggesterConfig: {
      multiSelect: true,
      caseSensitive: false
    },
    placeholder: "Type or select multiple tags..."
  }
]);

// Result: values.tags = "#work, #project, #urgent"
// Split into array if needed:
const tagArray = values.tags.split(', ').filter(Boolean);
```

### `inputPrompt(header: string, placeholder?: string, value?: string, options?: { cursorAtEnd?: boolean }): Promise<string>`
Opens a prompt that asks for text input.

**Parameters:**
- `header`: The prompt title/question
- `placeholder`: (Optional) Placeholder text in the input field
- `value`: (Optional) Default value
- `options.cursorAtEnd`: (Optional) When `true`, places the caret after the default value instead of selecting it

**Returns:** Promise resolving to the entered string.

**Cancellation:** If the user cancels or presses Escape, the promise rejects with `MacroAbortError("Input cancelled by user")`. Letting it bubble will stop the macro automatically. Catch it only if your script wants to handle the cancellation itself.

**Example:**
```javascript
try {
	const name = await quickAddApi.inputPrompt(
		"What's your name?",
		"Enter your full name",
		"John Doe"
	);
	console.log(`Hello, ${name}!`);
} catch (error) {
	if (error?.name === "MacroAbortError") {
		// Optional: perform cleanup before QuickAdd aborts the macro
		return;
	}
	throw error;
}
```

### `wideInputPrompt(header: string, placeholder?: string, value?: string, options?: { cursorAtEnd?: boolean }): Promise<string>`
Opens a wider prompt for longer text input (multi-line).

**Parameters:** Same as `inputPrompt`

**Returns:** Promise resolving to the entered string. Cancelling rejects with `MacroAbortError` (same as `inputPrompt`).

**Keyboard:** Pressing **Tab** inserts a tab character at the cursor (handy for nested Markdown lists) instead of moving focus; with text selected, Tab indents every line the selection touches. **Shift+Tab** still moves focus out of the field. See [multi-line input](./FormatSyntax.md#value-multiline).

**Example:**
```javascript
const description = await quickAddApi.wideInputPrompt(
    "Project Description",
    "Enter a detailed description...",
    "This project aims to..."
);
```

### `yesNoPrompt(header: string, text?: string): Promise<boolean>`
Opens a confirmation dialog with Yes/No buttons.

**Parameters:**
- `header`: The dialog title
- `text`: (Optional) Additional explanation text

**Returns:** Promise resolving to `true` (Yes) or `false` (No). If the user closes the dialog without answering, the promise rejects with `MacroAbortError`.

**Example:**
```javascript
const confirmed = await quickAddApi.yesNoPrompt(
    "Delete Note?",
    "This action cannot be undone."
);

if (confirmed) {
    // Proceed with deletion
}
```

### `infoDialog(header: string, text: string[] | string): Promise<void>`
Shows an information dialog with an OK button.

**Parameters:**
- `header`: Dialog title
- `text`: Single string or array of strings (for multiple lines)

**Example:**
```javascript
await quickAddApi.infoDialog(
    "Operation Complete",
    [
        "Files processed: 10",
        "Errors: 0",
        "Time taken: 2.5 seconds"
    ]
);
```

### `suggester(displayItems: string[] | Function, actualItems: any[], placeholder?: string, allowCustomInput?: boolean, options?: { renderItem?: (value: any, el: HTMLElement) => void }): Promise<any>`
Opens a single-selection prompt with searchable options. Can optionally allow custom input not in the predefined list.

`quickAddApi.suggester(...)` is single-select only. It returns one selected `actualItems` value, or a custom string when `allowCustomInput` is enabled. For multiple selections, use `checkboxPrompt(...)` for a list of string options, or `requestInputs(...)` with a `type: "suggester"` input and `suggesterConfig.multiSelect: true`. Those multi-select alternatives return strings/text values rather than the selected record objects that `quickAddApi.suggester(...)` can return, so map the returned strings back to your records if needed.

**Parameters:**
- `displayItems`: Array of display strings OR a map function
- `actualItems`: Array of actual values to return (strings or objects)
- `placeholder`: (Optional) Placeholder text shown in the suggester
- `allowCustomInput`: (Optional) When `true`, allows users to enter custom text not in `actualItems`. Defaults to `false`
- `options.renderItem`: (Optional) Custom renderer `(value, el) => void` to control how each suggestion row is drawn

**Returns:** Promise resolving to the selected value or custom input. Cancelling rejects with `MacroAbortError`.

**Examples:**

Basic usage:
```javascript
const fruit = await quickAddApi.suggester(
    ["🍎 Apple", "🍌 Banana", "🍊 Orange"],
    ["apple", "banana", "orange"]
);
```

With placeholder text:
```javascript
const fruit = await quickAddApi.suggester(
    ["🍎 Apple", "🍌 Banana", "🍊 Orange"],
    ["apple", "banana", "orange"],
    "Choose your favorite fruit"
);
```

With map function:
```javascript
const files = app.vault.getMarkdownFiles();
const selectedFile = await quickAddApi.suggester(
    file => file.basename,  // Display just the filename
    files                   // Return the full file object
);
```

Complex objects:
```javascript
const tasks = [
    { id: 1, title: "Task 1", priority: "high" },
    { id: 2, title: "Task 2", priority: "low" }
];

const selectedTask = await quickAddApi.suggester(
    task => `${task.title} (${task.priority})`,
    tasks,
    "Select a task to edit"
);
```

Allow custom input (like quick switcher):
```javascript
// User can select from existing tags or type a new one
const existingTags = ["#project", "#personal", "#work"];
const selectedTag = await quickAddApi.suggester(
    existingTags,
    existingTags,
    "Select existing tag or type new one",
    true  // allowCustomInput = true
);
// Returns either an existing tag or the user's custom input
```

#### Custom rendering
You can take full control over how suggestions are rendered by providing `options.renderItem`. The function receives the actual item value and the suggestion row element. If the renderer throws, QuickAdd falls back to default rendering.

Custom-rendered list (no custom input):
```javascript
// Shows a color dot + subtitle; stores result in variables.project
module.exports = async (params) => {
  const { quickAddApi } = params;

  const items = [
    { name: 'Inbox',   path: 'Projects/Inbox.md',   status: 'Active' },
    { name: 'Roadmap', path: 'Projects/Roadmap.md', status: 'Paused' },
    { name: 'Backlog', path: 'Projects/Backlog.md', status: 'Done' },
  ];

  const values = items.map(i => i.name);
  const meta = Object.fromEntries(items.map(i => [i.name, i]));

  const selected = await quickAddApi.suggester(
    values,         // display items
    values,         // actual items
    'Pick a project',
    false,          // allowCustomInput
    {
      renderItem: (value, el) => {
        const info = meta[value] || {};
        const row = el.createEl('div');
        const title = row.createEl('div', { cls: 'qa-title' });

        const dot = title.createEl('span');
        dot.setAttr('style', 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;'
          + `background:${statusColor(info.status)};`);

        title.createEl('span', { text: value });

        const sub = row.createEl('div', { text: info.path || '' });
        sub.setAttr('style', 'font-size:12px;color:var(--text-muted);');
      }
    }
  );

  if (!selected) return;
  params.variables.project = selected;
  return selected;

  function statusColor(status) {
    switch (status) {
      case 'Active': return 'var(--text-accent)';
      case 'Paused': return 'orange';
      case 'Done':   return 'var(--interactive-accent)';
      default:       return 'var(--text-muted)';
    }
  }
};
```

Allow custom input with tailored rendering:
```javascript
// Highlights when value is new; stores result in variables.project
module.exports = async (params) => {
  const { quickAddApi } = params;
  const values = ['Inbox', 'Roadmap', 'Backlog'];

  const selected = await quickAddApi.suggester(
    values,
    values,
    'Type a new project or pick…',
    true, // allowCustomInput
    {
      renderItem: (value, el) => {
        const isNew = !values.includes(value);
        const row = el.createEl('div');

        const title = row.createEl('div', { text: value });
        title.setAttr('style', 'font-weight:600;');

        const hint = isNew ? 'New project (press Enter to create)' : 'Existing project';
        const sub = row.createEl('div', { text: hint });
        sub.setAttr('style', 'font-size:12px;color:var(--text-muted);');
      }
    }
  );

  if (!selected) return;
  params.variables.project = selected;
  return selected;
};
```

### `checkboxPrompt(items: string[], selectedItems?: string[]): Promise<string[]>`
Opens a checkbox prompt allowing multiple selections.

**Parameters:**
- `items`: Array of options to display
- `selectedItems`: (Optional) Array of pre-selected items

**Returns:** Promise resolving to an array of selected item strings.

**Example:**
```javascript
const features = await quickAddApi.checkboxPrompt(
    ["Dark Mode", "Auto-save", "Spell Check", "Line Numbers"],
    ["Auto-save", "Line Numbers"]  // Pre-selected
);

console.log("Enabled features:", features);
```

## Choice Execution

### `executeChoice(choiceName: string, variables?: {[key: string]: any}): Promise<void>`
Executes another QuickAdd choice programmatically.

**Parameters:**
- `choiceName`: Name of the choice to execute
- `variables`: (Optional) Variables to pass to the choice

**Example:**
```javascript
// Execute a template choice with variables
await quickAddApi.executeChoice("Create Meeting Note", {
    meetingTitle: "Project Review",
    attendees: "John, Jane, Bob",
    date: "2024-01-15",
    value: "Main agenda content"  // Special: maps to {{VALUE}}
});
```

Batch processing example:
```javascript
const contacts = [
    { name: "John Doe", email: "john@example.com", company: "ACME" },
    { name: "Jane Smith", email: "jane@example.com", company: "Tech Corp" }
];

for (const contact of contacts) {
    await quickAddApi.executeChoice("Create Contact", {
        contactName: contact.name,
        contactEmail: contact.email,
        contactCompany: contact.company
    });
}
```

### `applyTemplateToActiveFile(templatePath: string, options?: { mode?: "cursor" | "top" | "bottom" | "replace" }): Promise<TFile | null>`
Applies a template to the active note without creating a new file. The template runs through the full QuickAdd format pipeline (`{{title}}` and the unnamed `{{VALUE}}`/`{{NAME}}` resolve to the note's basename), and Templater syntax is processed. See [Apply Template to Note](./ApplyTemplateToNote.md) for the full behavior, including frontmatter merging.

**Parameters:**
- `templatePath`: Vault path to the template file
- `options.mode`: (Optional) How to apply the template. Defaults to `"replace"` for empty notes and `"bottom"` otherwise.
  - `"cursor"`: Insert at the cursor position (requires the note to be open in the active editor)
  - `"top"`: Insert below the note's frontmatter
  - `"bottom"`: Append to the end of the note
  - `"replace"`: Replace the entire note content

**Returns:** The target file, or `null` if nothing was applied (e.g., no active markdown note).

**Example:**
```javascript
// Apply a meeting template to the currently open note
await quickAddApi.applyTemplateToActiveFile("templates/meeting.md", {
    mode: "top"
});
```

## Utility Module

Access via `quickAddApi.utility`:

### `getClipboard(): Promise<string>`
Gets the current clipboard contents.

**Example:**
```javascript
const clipboardText = await quickAddApi.utility.getClipboard();
console.log("Clipboard contains:", clipboardText);
```

### `setClipboard(text: string): Promise<void>`
Sets the clipboard contents.

**Example:**
```javascript
await quickAddApi.utility.setClipboard("Hello, World!");
```

### `getSelection(): string`
Gets the currently selected text in the active editor. Returns an empty string if
there is no active editor or no selection.

**Example:**
```javascript
const selection = quickAddApi.utility.getSelection();
if (selection) {
    console.log("Selected:", selection);
}
```

Combined example:
```javascript
// Transform clipboard contents
const original = await quickAddApi.utility.getClipboard();
const transformed = original.toUpperCase();
await quickAddApi.utility.setClipboard(transformed);
```

## Date Module

Access via `quickAddApi.date`:

### `now(format?: string, offset?: number): string`
Gets formatted current date/time.

**Parameters:**
- `format`: (Optional) Moment.js format string, defaults to "YYYY-MM-DD"
- `offset`: (Optional) Day offset (negative for past, positive for future)

**Examples:**
```javascript
// Current date
const today = quickAddApi.date.now();  // "2024-01-15"

// Custom format
const timestamp = quickAddApi.date.now("YYYY-MM-DD HH:mm:ss");

// With offset
const nextWeek = quickAddApi.date.now("YYYY-MM-DD", 7);
const lastMonth = quickAddApi.date.now("YYYY-MM-DD", -30);
```

### `tomorrow(format?: string): string`
Shorthand for `now(format, 1)`.

### `yesterday(format?: string): string`
Shorthand for `now(format, -1)`.

**Example:**
```javascript
const yesterdayLog = `Daily Notes/${quickAddApi.date.yesterday()}.md`;
const tomorrowTask = `Tasks for ${quickAddApi.date.tomorrow("dddd, MMMM D")}`;
```

## AI Module

Access via `quickAddApi.ai`:

### `prompt(prompt: string, model: string | {name: string}, settings?: object): Promise<object>`
Sends a prompt to an AI model and returns the response.

**Parameters:**
- `prompt`: The prompt text
- `model`: Model identifier - either a string (e.g., `"gpt-4"`) or object with name property (e.g., `{name: "gpt-4"}`). The model must be configured in Settings → QuickAdd → AI → Providers.
- `settings`: (Optional) Configuration object:
  - `variableName`: Output variable name (default: "output")
  - `shouldAssignVariables`: Auto-assign to variables (default: false)
  - `modelOptions`: Model parameters (temperature, max_tokens, etc.)
  - `showAssistantMessages`: Show AI responses in UI (default: true)
  - `systemPrompt`: Override system prompt

**Returns:** Object with:
- `[variableName]`: The AI response
- `[variableName]-quoted`: The response in markdown quote format

**Example using string:**
```javascript
const result = await quickAddApi.ai.prompt(
    "Summarize this text: " + noteContent,
    "gpt-4",
    {
        variableName: "summary",
        modelOptions: {
            temperature: 0.3,
            max_tokens: 150
        }
    }
);

console.log(result.summary);
// Use in template: {{VALUE:summary}}
```

**Example using Model object:**
```javascript
const result = await quickAddApi.ai.prompt(
    "What is the capital of France?",
    {name: "gpt-4"},
    {
        variableName: "capital",
        shouldAssignVariables: true,
        modelOptions: {
            temperature: 0.6,
            max_tokens: 60
        }
    }
);
```

**Note:** For newer models like `gpt-4o` or custom provider models, add them in Settings → QuickAdd → AI → Providers. Some providers support auto-sync to automatically update available models.

### `chunkedPrompt(text: string, promptTemplate: string, model: string | {name: string}, settings?: object): Promise<object>`
Splits `text` into chunks, runs `promptTemplate` once per chunk, and joins the
results. Use this for inputs that are too large for a single request.

**Parameters:**
- `text`: The full input text to process.
- `promptTemplate`: The prompt run for each chunk. Reference the current chunk with `{{value:chunk}}`.
- `model`: Model identifier (string or `{name}`), as for `prompt`.
- `settings`: (Optional) Configuration object:
  - `variableName`: Output variable name (default: "output")
  - `shouldAssignVariables`: Auto-assign to variables (default: false)
  - `modelOptions`: Model parameters (temperature, max_tokens, etc.)
  - `showAssistantMessages`: Show AI responses in UI (default: true)
  - `systemPrompt`: Override system prompt
  - `chunkSeparator`: `RegExp` used to split `text` (default: `/\n/`)
  - `chunkJoiner`: String inserted between chunk results (default: `"\n"`)
  - `shouldMerge`: Merge small adjacent chunks up to the budget (default: `true`)
  - `maxChunkTokens`: Maximum **estimated** tokens for each chunk's text (the `{{value:chunk}}` portion only — the system prompt and prompt template are budgeted separately). Token counts are estimated locally; values above the model's estimated input budget are capped automatically.

**Behavior:**
- Chunk sizes are estimated locally (QuickAdd no longer bundles model-specific tokenizers); the configured provider remains the source of truth for exact limits.
- A chunk larger than the budget is split near a natural boundary (paragraph, sentence, or space) so it still fits — including when `shouldMerge` is `false`.
- If the provider still rejects a prompt because the **input** exceeds its context window, that chunk is split and retried automatically. Output/completion-budget and quota errors are surfaced as-is (splitting cannot fix them).
- The prompt template is rendered through the formatter once per chunk (plus once for sizing), so side-effectful tokens such as `{{MACRO:…}}` run on every render — avoid them inside a `chunkedPrompt` template.

**Returns:** Object with `[variableName]` (joined results) and `[variableName]-quoted`.

```javascript
const result = await quickAddApi.ai.chunkedPrompt(
    longText,
    "Summarize this section:\n{{value:chunk}}",
    "gpt-4o",
    { variableName: "summary", chunkJoiner: "\n\n" }
);
```

### Tool / function calling — `ai.agent(config)`

Build an **agent**: give the model a prompt and a set of *tools* (JS functions), and it
will call them in a bounded multi-step loop until it has an answer. Works across your
configured OpenAI-compatible, Anthropic, and Gemini providers.

```js
const agent = quickAddApi.ai.agent({
  model: "gpt-5",
  system: "You manage an Obsidian vault. Use the tools to ground your answers.",
  tools: {
    // built-in tools, opt-in (see ai.tools.* below)
    ...quickAddApi.ai.tools.vault({ only: ["read_note", "search_notes"] }),
    // your own tool
    save_link: quickAddApi.ai.tool({
      description: "Append a URL to the reading-list note.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      needsApproval: true, // ask before running (the model chose the args)
      execute: async ({ url }) => {
        const file = app.vault.getAbstractFileByPath("Reading list.md");
        await app.vault.append(file, `\n- ${url}`);
        return { saved: true };
      },
    }),
  },
  maxSteps: 12, // optional; default 20, hard-capped at 100
});

const { text, steps, toolCalls } = await agent.generate({
  prompt: "Summarise my notes about {{VALUE:topic}} and save any links you find.",
  assignToVariable: "summary", // optional: writes {{VALUE:summary}} for a later step
});
```

**`ai.agent(config)`** returns an Agent. Config:
- `model` — a configured model name (string) or `{ name }`.
- `system` — system prompt (defaults to your AI Assistant default system prompt).
- `tools` — an object map of tool name → tool (from `ai.tool()` and/or `ai.tools.*`).
- `toolChoice` — `"auto"` (default) | `"none"` | `"required"` | `{ type: "tool", toolName }`.
- `stopWhen` — one or more stop conditions from `ai.stepCountIs(n)` / `ai.hasToolCall(name)`.
- `maxSteps` — step budget (default 20, hard cap 100). Sugar for `stopWhen: ai.stepCountIs(n)`.
- `maxOutputTokens`, `modelOptions` — passed to the provider.

**`agent.generate(options)`** runs the loop and resolves to a result:
- `text` — the final assistant text.
- `object` — present **only** when you pass a `schema` (structured output, below).
- `steps` — the full transcript: `{ text, toolCalls, toolResults, finishReason }[]`.
- `toolCalls` / `toolResults` — from the last step (`input` / `output` fields, AI-SDK style).
- `usage` — `{ inputTokens, outputTokens, totalTokens }`.
- `finishReason` — `"stop" | "max-steps" | "length" | "aborted" | "context-overflow"`.

Options: `prompt` (formatted, like `ai.prompt`), `schema`, `system`/`toolChoice`/`maxOutputTokens`
(per-call overrides), and `assignToVariable` (write `text` into `{{VALUE:name}}`).

The agent is a **stateless config holder** — each `generate()` is independent (no retained
conversation). Reuse means reusing the config; run one `generate()` at a time per agent.

### `ai.tool(def)`

Declares a tool. `def`: `{ description, inputSchema (JSON Schema), execute, needsApproval?, readOnly?, strict? }`.

- `inputSchema` is a **JSON-Schema subset** (`type`/`properties`/`required`/`enum`/`items`).
  Unsupported keywords (`pattern`, `additionalProperties`, `$ref`, `format`, …) are rejected
  at registration so a provider can't silently drop a constraint.
- `execute(input, ctx)` runs your code with the model-chosen `input` (validated against the
  schema first). Return a string (used verbatim) or any JSON-serialisable value.
- `needsApproval` (boolean or `(args) => boolean`) asks before running. `readOnly: true` marks a
  tool that only reads, so it auto-runs under the default confirmation setting.

:::note Confirmation needs an interactive Obsidian session
A tool that asks for approval opens a modal and waits for it. For unattended automation (e.g.
driving QuickAdd from the CLI), give the agent only `readOnly` tools, or set **Confirm AI tool
calls** to *Never* and gate each tool with its own `needsApproval` — otherwise the run blocks on a
dialog no one can answer.
:::

> ⚠️ **Security.** Tool handlers run with the same full privilege as your script (Node `require`,
> `app`, the vault). The **model decides which tool to call and with what arguments**, possibly
> influenced by note content it reads (indirect prompt injection). QuickAdd never runs model-chosen
> arguments through the formatter — and **neither should you**: never pass a tool's `input` to
> `quickAddApi.format()`, `eval`, a shell, or `fetch` without validating it. Never put secrets in a
> tool's description or arguments (they are sent to the provider). Confirmation is governed by each
> tool's `needsApproval` plus the global **Confirm AI tool calls** setting (default *destructive only*).

### Built-in tools — `ai.tools.{vault, workspace, system}(options)`

Opt-in groups of ready-made tools. Each returns a tool map you spread into an agent's `tools`.
Options: `{ only, exclude, prefix, allowedRoots }` (`allowedRoots` confines a group to the listed
folders).

| Group | Read-only (auto-run) | Write (asks for approval) |
|---|---|---|
| `vault` | `read_note`, `list_notes`, `search_notes`, `get_property_values` | `create_note`, `append_to_note`, `insert_under_heading` |
| `workspace` | `get_active_note`, `get_selection` | — |
| `system` | `get_date` | — |

Write tools sanitise every model-chosen path (rejecting traversal and config dirs like `.obsidian`/
`.git`, and symlinks that escape the vault), fail rather than overwrite an existing note, and are
frontmatter-aware. There are **no ambient tools** — nothing runs unless you spread it into `tools`.

`allowedRoots` confines both groups it applies to. For `vault` it bounds the paths the model may
read or write. For `workspace` it bounds which file's content the agent can pull in: `get_active_note`
returns `active:null` and `get_selection` returns an empty string whenever the currently-open file
lives **outside** the roots, so a note you fenced off can't be surfaced into the transcript by a
model steered through injected content. (`system` ignores it — `get_date` touches no files.) An
absent or all-blank `allowedRoots` is vault-wide, the default. Note that confinement scopes what
*these* tools expose; it is not a sandbox for an untrusted agent — your own script's `require`/
`fetch`/`quickAddApi.utility.*` remain ambient — so only hand a group to an agent you trust with the
folders you grant it.

### Structured output — `agent.generate({ prompt, schema })`

Pass a JSON schema to get a validated object back:

```js
const { object } = await quickAddApi.ai.agent({ model: "gpt-5" }).generate({
  prompt: "Extract the title and tags from the selection.",
  schema: {
    type: "object",
    properties: { title: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
    required: ["title", "tags"],
  },
});
// object => { title: "...", tags: ["...", "..."] }
```

`object` is the parsed, schema-validated result (or `undefined` if the model could not produce a
match after one repair attempt). Structured output works on current models — OpenAI GPT-5.x (and
GPT-4o-class), Anthropic Claude 4.x, and Gemini 3.x; it can be combined with tools. Older models
that do not support schema-constrained output (e.g. legacy OpenAI chat models) reject the request
outright with a provider error — use a current model rather than expecting a best-effort fallback.

:::note OpenAI reasoning models (GPT-5.x, o-series)
These accept only the default `temperature` (omit it from `modelOptions`), and QuickAdd
automatically sends `maxOutputTokens` as `max_completion_tokens` for them. The agent's default
path sets neither, so `quickAddApi.ai.agent({ model: "gpt-5" })` works as-is.
:::

### `getModels(): string[]`
Returns available AI models.

**Example:**
```javascript
const models = quickAddApi.ai.getModels();
const selectedModel = await quickAddApi.suggester(models, models);
```

### `getMaxTokens(model: string): number`
Gets the maximum token limit for a model.

### `estimateTokens(text: string): number`
Estimates the token count for text using QuickAdd's provider-agnostic estimator.
This is useful for rough prompt sizing, but the configured AI provider remains
the source of truth for exact context limits and usage.

**Example:**
```javascript
const text = await quickAddApi.utility.getClipboard();
const tokenCount = quickAddApi.ai.estimateTokens(text);

if (tokenCount > 4000) {
    await quickAddApi.infoDialog(
        "Text Might Be Too Long",
        `The text is estimated at ${tokenCount} tokens.`
    );
}
```

### `countTokens(text: string, model: string | {name: string}): number`
Compatibility alias for `estimateTokens`. The `model` argument (a model name or
object) is accepted for existing scripts but ignored, since QuickAdd no longer
bundles model-specific tokenizers. Prefer `estimateTokens(text)`.

### `getRequestLogs(limit?: number): Array<object>`
Returns recent in-memory AI request logs (newest first).

**What each entry includes:**
- `id`: unique request id (also shown in console lifecycle logs)
- `createdAt`: timestamp
- `provider`, `endpoint`, `model`
- `systemPrompt`, `prompt` (the final sent text)
- `modelOptions`
- `status`: `pending | success | error`
- `durationMs`
- `usage` (when available)
- `errorMessage` (when failed)

**Notes:**
- Logs are stored in memory only (not persisted to vault files).
- QuickAdd keeps up to 25 completed entries.
- If more than 25 requests are still in-flight (`pending`), those pending entries
  are kept until they finish, then older completed entries are trimmed.

**Example:**
```javascript
const logs = quickAddApi.ai.getRequestLogs(10);
const latest = logs[0];
console.log(latest?.id, latest?.status, latest?.model);
```

### `getLastRequestLog(): object | null`
Returns the latest AI request log entry, or `null` if none exist.

### `getRequestLogById(id: string): object | null`
Returns a specific AI request log entry by id.

**Example:**
```javascript
const last = quickAddApi.ai.getLastRequestLog();
if (!last) return;

const sameRequest = quickAddApi.ai.getRequestLogById(last.id);
console.log(sameRequest?.prompt);
```

### `clearRequestLogs(): void`
Clears all in-memory AI request logs.

## Complete Example: Research Assistant

Here's a comprehensive example combining multiple API features:

```javascript
module.exports = async (params) => {
    const { quickAddApi, app, variables } = params;
    
    try {
        // Get research parameters
        const topic = await quickAddApi.inputPrompt("Research Topic:");
        if (!topic) return;
        
        const sources = await quickAddApi.checkboxPrompt(
            ["Web Search", "Academic Papers", "Books", "Videos"],
            ["Web Search", "Academic Papers"]
        );
        
        // AI-assisted outline generation
        const { outline } = await quickAddApi.ai.prompt(
            `Create a research outline for: ${topic}`,
            "gpt-4",
            {
                variableName: "outline",
                shouldAssignVariables: true,
                modelOptions: { temperature: 0.7 }
            }
        );
        
        // Create folder structure
        const folder = `Research/${topic}`;
        
        // Check if folder exists before creating
        try {
            const folderExists = await app.vault.adapter.exists(folder);
            if (!folderExists) {
                await app.vault.createFolder(folder);
            }
        } catch (err) {
            console.error(`Failed to create folder: ${err}`);
            new Notice(`Failed to create research folder: ${err.message}`);
            return;
        }
        
        // Set variables for templates
        variables.topic = topic;
        variables.sources = sources.join(", ");
        variables.date = quickAddApi.date.now("YYYY-MM-DD HH:mm");
        variables.outline = outline;
        
        // Execute template choice
        await quickAddApi.executeChoice("Research Template", variables);
        
        // Show completion
        await quickAddApi.infoDialog(
            "Research Project Created",
            [
                `Topic: ${topic}`,
                `Sources: ${sources.length} selected`,
                `Location: ${folder}`,
                "AI outline generated successfully"
            ]
        );
        
    } catch (error) {
        console.error("Research assistant error:", error);
        new Notice(`Error: ${error.message}`);
    }
};
```

## Error Handling Best Practices

Always wrap API calls in try-catch blocks:

```javascript
module.exports = async (params) => {
    const { quickAddApi } = params;
    
    try {
        const input = await quickAddApi.inputPrompt("Enter value:");
        
        if (!input) {
            // User cancelled - handle gracefully
            return;
        }
        
        // Process input...
        
    } catch (error) {
        console.error("Script error:", error);
        
        await quickAddApi.infoDialog(
            "Error",
            `An error occurred: ${error.message}`
        );
    }
};
```

## Performance Tips

1. **Batch Operations**: Use loops wisely to avoid overwhelming the system
2. **Debounce User Input**: Add delays between rapid operations
3. **Check File Existence**: Verify files exist before operations
4. **Validate Input**: Always validate user input before processing

## Field Suggestions Module

Access via `quickAddApi.fieldSuggestions`:

### `getFieldValues(fieldName: string, options?: object): Promise<string[]>`
Retrieves all unique values for a specific field across your vault.

**Parameters:**
- `fieldName`: The name of the field to search for
- `options`: (Optional) Filtering options:
  - `folder`: Only search in a specific folder (e.g., "daily/notes")
  - `folders`: Only search in any of these folders (OR filter)
  - `tags`: Only search in files with all of these tags (AND filter)
  - `includeInline`: Include Dataview inline fields (default: false)
  - `includeInlineCodeBlocks`: Include inline fields inside specific fenced code block types when `includeInline` is true (e.g., `["ad-note"]`)

**Returns:** Promise resolving to sorted array of unique field values

**Examples:**

Basic usage:
```javascript
// Get all status values in vault
const statuses = await quickAddApi.fieldSuggestions.getFieldValues("status");
const selected = await quickAddApi.suggester(statuses, statuses);
```

With folder filter:
```javascript
// Get project types only from projects folder
const projectTypes = await quickAddApi.fieldSuggestions.getFieldValues(
    "type",
    { folder: "projects" }
);
```

With multiple folder filters:
```javascript
// Get relation types from either goals or projects
const relationTypes = await quickAddApi.fieldSuggestions.getFieldValues(
    "type",
    { folders: ["goals", "projects"] }
);
```

With tag filter:
```javascript
// Get priorities from files tagged with both #work and #important
const priorities = await quickAddApi.fieldSuggestions.getFieldValues(
    "priority",
    { tags: ["work", "important"] }
);
```

Include inline fields:
```javascript
// Get all client names including inline fields
const clients = await quickAddApi.fieldSuggestions.getFieldValues(
    "client",
    { 
        folder: "work/projects",
        includeInline: true 
    }
);
```

Include inline fields in specific code block types:
```javascript
const ids = await quickAddApi.fieldSuggestions.getFieldValues(
    "Id",
    {
        folder: "work/projects",
        includeInline: true,
        includeInlineCodeBlocks: ["ad-note"]
    }
);
```

### `clearCache(fieldName?: string): void`
Clears the field suggestions cache for better performance.

**Parameters:**
- `fieldName`: (Optional) Specific field to clear, or clears all if omitted

**Example:**
```javascript
// Clear cache for specific field after bulk updates
await quickAddApi.fieldSuggestions.clearCache("status");

// Clear entire cache
await quickAddApi.fieldSuggestions.clearCache();
```

### Complete Field Management Example

```javascript
module.exports = async (params) => {
    const { quickAddApi, app, variables } = params;
    
    // Smart task creation with field suggestions
    const taskType = await quickAddApi.suggester(
        await quickAddApi.fieldSuggestions.getFieldValues("type", {
            folder: "tasks"
        }),
        await quickAddApi.fieldSuggestions.getFieldValues("type", {
            folder: "tasks"
        })
    );
    
    const priority = await quickAddApi.suggester(
        ["🔴 High", "🟡 Medium", "🟢 Low"],
        await quickAddApi.fieldSuggestions.getFieldValues("priority") || 
        ["high", "medium", "low"]
    );
    
    const assignee = await quickAddApi.suggester(
        await quickAddApi.fieldSuggestions.getFieldValues("assignee", {
            tags: ["person"],
            includeInline: true
        }),
        await quickAddApi.fieldSuggestions.getFieldValues("assignee", {
            tags: ["person"],
            includeInline: true
        })
    );
    
    // Create task with consistent field values
    variables.type = taskType;
    variables.priority = priority;
    variables.assignee = assignee;
    
    await quickAddApi.executeChoice("Create Task", variables);
};
```

## See Also

- [Macro Choices](./Choices/MacroChoice.md) - Using scripts in macros
- [Inline Scripts](./InlineScripts.md) - Using scripts in templates
- [Format Syntax](./FormatSyntax.md) - Template variables
- [Examples](./Examples/Macro_BookFinder.md) - Practical implementations
