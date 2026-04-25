---
title: QuickAdd CLI
---

QuickAdd now registers native Obsidian CLI handlers when your Obsidian version
supports plugin CLI commands.

## Requirements

- Obsidian `1.12.2` or newer (plugin CLI handler API introduced in `1.12.2`)
- QuickAdd enabled in the target vault

## Commands

### `quickadd` / `quickadd:run`

Run a QuickAdd choice from the CLI.

```bash
obsidian vault=dev quickadd choice="Daily log"
obsidian vault=dev quickadd:run id="choice-id"
```

### `quickadd:list`

List all QuickAdd choices (including nested choices inside multis).

```bash
obsidian vault=dev quickadd:list
obsidian vault=dev quickadd:list type=Capture
obsidian vault=dev quickadd:list commands
```

### `quickadd:check`

Check which inputs are still missing before a non-interactive run.

```bash
obsidian vault=dev quickadd:check choice="Daily log"
```

The check command is flow-aware. For macros, it follows nested Template and Capture choices, reports missing inputs for the whole flow, and includes diagnostics in the JSON response:

- `diagnostics`: runtime, nested-choice, and integration capability notes.
- `flow.choices`: choices included in the check, with path and depth.
- `missingFlags`: CLI flags you can pass to satisfy unresolved inputs.

Example response shape:

```json
{
  "ok": false,
  "command": "quickadd:check",
  "requiredInputCount": 1,
  "missingInputCount": 1,
  "missingFlags": ["value-project=<value>"],
  "diagnostics": [
    {
      "severity": "error",
      "code": "missing-required-inputs",
      "source": "runtime",
      "message": "1 required input(s) are missing for this flow."
    }
  ],
  "flow": {
    "choiceCount": 2,
    "choices": []
  }
}
```

## Passing variables

QuickAdd CLI supports three variable patterns:

1. `value-<name>=...` (URI-compatible)
2. extra `key=value` args
3. `vars=<json-object>` for structured values

Examples:

```bash
obsidian vault=dev quickadd \
  choice="Daily log" \
  value-project="QuickAdd" \
  mood="focused"

obsidian vault=dev quickadd \
  choice="Daily log" \
  vars='{"project":"QuickAdd","sprint":42}'
```

## Non-interactive behavior

By default, `quickadd` and `quickadd:run` are non-interactive. If QuickAdd
detects missing inputs, it returns a JSON payload with `missing` fields and
`missingFlags` suggestions instead of opening prompts.

Use `ui` to allow interactive prompts:

```bash
obsidian vault=dev quickadd choice="Daily log" ui
```

