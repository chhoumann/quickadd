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
  missing `.md` extension is added, matching how Template choices resolve paths.
  If no file resolves there, the command returns `{"ok":false}` up front.
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

Values are passed through exactly as provided. If a choice should ignore accidental leading or trailing whitespace for a specific token, use `|trim` in that format string, for example `{{VALUE:project|trim}}`.

### Reserved flag names

The bare `key=value` form (pattern 2) ignores names that a command already uses
as flags or selectors: `choice`, `id`, `vars`, `ui`, `verify` (on `quickadd` /
`quickadd:run`), `fields` (on `quickadd:check`), and `path` (on
`quickadd:run-template`). If a choice has a variable named after one of these
(for example `{{VALUE:verify}}`), pass it with the `value-` prefix or via `vars`
instead, both of which are never treated as flags:

```bash
obsidian vault=dev quickadd choice="My choice" value-verify="a value"
obsidian vault=dev quickadd choice="My choice" vars='{"verify":"a value"}'
```

## Non-interactive behavior

By default, `quickadd` and `quickadd:run` are non-interactive. If QuickAdd
detects missing inputs, it returns a JSON payload with `missing` fields and
`missingFlags` suggestions instead of opening prompts.

Pass a returned `missingFlags` entry back exactly as shown. Some generated flags
fill internal runtime selections, such as a preselected capture target file.

Use `ui` to allow interactive prompts:

```bash
obsidian vault=dev quickadd choice="Daily log" ui
```

## Interactive runs (`quickadd:interactive`)

Some choices prompt at *run time* for inputs that can't be collected up front -
a macro's `quickAddApi.suggester` over data it just fetched, an `inputPrompt`,
`yesNoPrompt`, `checkboxPrompt`, and so on. `quickadd:interactive` runs a choice
and **forwards those prompts to you over a local HTTP bridge** so an external
front end (Raycast, a script) can render them and answer, instead of the prompts
opening in Obsidian.

```bash
obsidian vault=dev quickadd:interactive choice="Import from Readwise"
# -> {"ok":true,"host":"127.0.0.1","port":51789,"sessionId":"…","token":"…"}
```

The command returns connection details immediately and runs the choice in the
background. Attach to the session and drive it:

- `GET  http://127.0.0.1:<port>/poll?session=<id>&token=<token>` - long-polls for
  the next event: `{"kind":"prompt","requestId":…,"prompt":{…}}`,
  `{"kind":"done","result":…}`, `{"kind":"error","error":…}`, or a periodic
  `{"kind":"idle"}` keepalive (just poll again).
- `POST http://127.0.0.1:<port>/reply?session=<id>&token=<token>` with body
  `{"requestId":…,"value":…}` to answer, or `{"requestId":…,"cancelled":true}`
  to cancel (which aborts the run).

Prompt `type`s and the `value` you reply with: `suggester`/`input`/`date` →
string, `confirm` → boolean, `checkbox` → string array, `info` →
acknowledgement, `form` → an object mapping each field's `id` to its string
value (date fields use the `@date:ISO` format). The run's outcome arrives as the
`done`/`error` poll event.

Notes:

- **Desktop only.** The bridge binds to `127.0.0.1`, is gated by the per-session
  `token`, rejects browser (`Origin`/`Referer`) and non-loopback `Host`
  requests, and the server is ephemeral - it starts on the first session and
  stops when the last one ends.
- **Concurrency.** Each run gets its own `sessionId` + `token`; many can run at
  once without interfering.
- If no client attaches within ~30s the run is aborted so a prompt can't hang
  forever.
