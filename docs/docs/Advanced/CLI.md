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

### `quickadd:run-template`

Create a new note from a template file — no dedicated Template choice required.
This is the scriptable form of the **New note from template** command.

```bash
obsidian vault=dev quickadd:run-template \
  path="Templates/Meeting.md" \
  value-value="2026-06-14 Standup"
```

- `path=` is the template file (vault-relative). A leading slash is allowed and a
  missing template source extension resolves as `.md`, matching how Template
  choices resolve paths. Configured source-only extensions such as `.eta` are
  accepted, but they still create markdown notes by default. If no file resolves
  there, the command returns `{"ok":false}` up front.
- The new note's name comes from `{{value}}` — pass it as `value-value=...`. A
  non-interactive run with an empty or missing name returns `missingFlags`
  instead of creating an unnamed note. The note is created in Obsidian's
  "Default location for new notes".
- The picker (interactive command) only lists templates inside your configured
  template folder(s); `path=` here is explicit, so any vault file resolves.
- Like `quickadd:run`, name collisions on the target note still prompt
  interactively (the file-exists choice is not a pre-collected input).

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
