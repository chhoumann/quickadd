---
title: QuickAdd CLI
description: Run, list, and check QuickAdd choices from Obsidian's native CLI, pass variables non-interactively, and create notes from templates
slug: docs/Advanced/CLI
---

QuickAdd hooks into Obsidian's own command-line interface, so you can run a
choice from a terminal, a shell script, or a scheduled job - no link-building or
extra plugins. Point the `obsidian` command at a vault and a choice, and it
runs.

```bash
obsidian vault=dev quickadd choice="Daily log"
```

QuickAdd registers these CLI handlers automatically on any Obsidian version that
supports plugin CLI commands.

## What you need {#requirements}

- Obsidian `1.12.2` or newer (the plugin CLI handler API arrived in `1.12.2`).
- QuickAdd enabled in the target vault.

## The commands {#commands}

### Run a choice: `quickadd` / `quickadd:run` {#quickadd--quickaddrun}

Run a QuickAdd choice from the CLI, by name or by id:

```bash
obsidian vault=dev quickadd choice="Daily log"
obsidian vault=dev quickadd:run id="choice-id"
```

### List your choices: `quickadd:list` {#quickaddlist}

List every QuickAdd choice (including nested choices inside multis):

```bash
obsidian vault=dev quickadd:list
obsidian vault=dev quickadd:list type=Capture
obsidian vault=dev quickadd:list commands
```

### See what a choice still needs: `quickadd:check` {#quickaddcheck}

Check which inputs are still missing before a non-interactive run:

```bash
obsidian vault=dev quickadd:check choice="Daily log"
```

### Create a note from a template: `quickadd:run-template` {#quickaddrun-template}

Create a new note from a template file, with no dedicated Template choice
required. This is the scriptable form of the **New note from template**
command.

```bash
obsidian vault=dev quickadd:run-template \
  path="Templates/Meeting.md" \
  value-value="2026-06-14 Standup"
```

- `path=` is the template file (vault-relative). A leading slash is allowed and a missing `.md` extension is added, matching how Template choices resolve paths. If no file resolves there, the command returns `{"ok":false}` up front.
- The new note's name comes from `{{VALUE}}` - pass it as `value-value=...`. A non-interactive run with an empty or missing name returns `missingFlags` instead of creating an unnamed note. The note is created in Obsidian's "Default location for new notes".
- The picker (interactive command) only lists templates inside your configured template folder(s); `path=` here is explicit, so any vault file resolves.
- Like `quickadd:run`, name collisions on the target note still prompt (the file-exists choice is not a pre-collected input). Under `quickadd:interactive` that prompt is forwarded to you like any other.

## Pass variables to a choice {#passing-variables}

QuickAdd's CLI accepts variables three ways:

1. `value-<name>=...` (the same form the URI uses)
2. extra `key=value` args
3. `vars=<json-object>` for structured values

```bash
obsidian vault=dev quickadd \
  choice="Daily log" \
  value-project="QuickAdd" \
  mood="focused"

obsidian vault=dev quickadd \
  choice="Daily log" \
  vars='{"project":"QuickAdd","sprint":42}'
```

Values are passed through exactly as provided. If a choice should ignore an
accidental leading or trailing space for a specific placeholder, use `|trim` in
that format string, for example `{{VALUE:project|trim}}`.

### Names the CLI reserves {#reserved-flag-names}

The bare `key=value` form (pattern 2) ignores names that a command already uses
as flags or selectors: `choice`, `id`, `vars`, `ui`, `verify` (on `quickadd` /
`quickadd:run`), `fields` (on `quickadd:check`), and `path` (on
`quickadd:run-template`). If a choice has a variable named after one of these
(for example `{{VALUE:verify}}`), pass it with the `value-` prefix or via
`vars` instead - neither is ever treated as a flag:

```bash
obsidian vault=dev quickadd choice="My choice" value-verify="a value"
obsidian vault=dev quickadd choice="My choice" vars='{"verify":"a value"}'
```

## What happens when inputs are missing {#non-interactive-behavior}

By default, `quickadd` and `quickadd:run` are non-interactive. If QuickAdd finds
missing inputs, it returns a JSON payload with `missing` fields and
`missingFlags` suggestions instead of opening prompts.

Pass a returned `missingFlags` entry back exactly as shown. Some generated flags
fill internal runtime selections, such as a preselected capture target file.

Add `ui` to allow interactive prompts:

```bash
obsidian vault=dev quickadd choice="Daily log" ui
```

In a [scheduled job](/docs/Advanced/TriggerQuickAddFromOutsideObsidian/#run-quickadd-on-a-schedule),
only add `ui` when the job runs while you are logged in and able to answer the
prompts.

## Knowing whether anything actually landed {#verified-and-effect}

`ok:true` means the choice ran without aborting. It does **not** mean your vault
changed. Two more keys answer the questions an automation actually asks:

| Key | Question it answers | Values |
| --- | --- | --- |
| `verified` | Did QuickAdd confirm what the engine did? | `true` on the outcome path (`verify` on a Template/Capture choice), `false` when it could not look |
| `effect` | What did the run do to the vault? | `created`, `changed`, `unchanged`, `unknown` |

```bash
obsidian vault=dev quickadd:run choice="Inbox" value-value="  " verify=true
# -> {"ok":true,"choice":{…},"file":"Inbox.md","verified":true,"effect":"unchanged","durationMs":6}
```

That run is working exactly as designed: the capture's payload was empty, so
QuickAdd deliberately left `Inbox.md` alone rather than writing a blank line, and
said so in a notice. A Template set to **Do nothing** when the file already exists
reports the same. If you are counting captures, writing an idempotency marker, or
deciding whether to retry, key off `effect`, not `ok`.

`effect` is present on every **success** payload (`ok:true`), and `unknown` is stated
rather than omitted - a missing key reads as `false` in both `jq` and JavaScript, which
would turn "QuickAdd did not look" into "nothing happened". A failed or cancelled run
carries `error` instead and no `effect`, because there is no outcome to describe.
`verified:false` still means only *"not confirmed - go look"*; it never means
*"confirmed that nothing changed"*.

The `obsidian://quickadd` [x-callback](/docs/Advanced/TriggerQuickAddFromOutsideObsidian/)
success callback carries the same `effect` value.

## Answer run-time prompts from outside: `quickadd:interactive` {#interactive-runs-quickaddinteractive}

Some choices prompt at *run time* for inputs that can't be gathered up front -
a macro's `quickAddApi.suggester` over data it just fetched, an `inputPrompt`,
`yesNoPrompt`, `checkboxPrompt`, and so on. `quickadd:interactive` runs a choice
and **forwards those prompts to you over a local HTTP bridge**, so an external
front end (Raycast, a script) can render them and send back answers, instead of
the prompts opening in Obsidian.

```bash
obsidian vault=dev quickadd:interactive choice="Import from Readwise"
# -> {"ok":true,"host":"127.0.0.1","port":51789,"sessionId":"…","token":"…","capabilities":["abort","outcome-effect"]}
```

The command returns connection details immediately and runs the choice in the
background. Attach to the session and drive it:

- `GET  http://127.0.0.1:<port>/poll?session=<id>&token=<token>` - long-polls for the next event: `{"kind":"prompt","requestId":…,"prompt":{…}}`, `{"kind":"done","result":…}`, `{"kind":"error","error":…}`, or a periodic `{"kind":"idle"}` keepalive (just poll again).
- `POST http://127.0.0.1:<port>/reply?session=<id>&token=<token>` with body `{"requestId":…,"value":…}` to answer, or `{"requestId":…,"cancelled":true}` to cancel (which ends the run - except on an `info` panel, see below).
- `POST http://127.0.0.1:<port>/abort?session=<id>&token=<token>` - end the run. Answers `{"ok":true,"interrupted":<n>}`, where `n` is how many pending prompts it rejected; `409` if the run had already finished (benign - poll for the terminal event); `404` for an unknown session or token, or for any method other than `POST`.

Prompts a Template or Capture run opens itself - the "file already exists" chooser,
the folder picker, the note-discovery picker, the heading picker, the capture-target
picker - are forwarded like any other. (The AI assistant's tool-confirmation dialog is
the one that is not: run such a choice at the desktop, or set tool confirmation to
"never".)

They arrive as `suggester` prompts, and because the engine controls the
list, a reply that is not one of the offered `value` tokens is refused rather than
acted on (unless the prompt sets `allowCustomInput`, as the folder and discovery
pickers do so you can create something new).

Prompt `type`s and the `value` you reply with: `suggester`/`input`/`date` →
string, `confirm` → boolean, `checkbox` → string array, `info` →
acknowledgement, `form` → an object mapping each field's `id` to its value.
Ordinary and date fields use strings (dates use the `@date:ISO` format), while
multi-select fields use string arrays. Use the array form for multi-selects so
values containing commas remain unambiguous. The run's outcome arrives as the
`done`/`error` poll event: `done` carries the same `verified` and `effect` keys
described under [Knowing whether anything actually landed](#verified-and-effect).

### Cancelling, and ending a run

`{"cancelled":true}` is how you say *the user dismissed this prompt*. It ends the
run exactly as pressing Escape on the in-app dialog does.

`info` is the exception, because the in-app dialog is: `GenericInfoDialog` resolves
on every close path and has no way to abort anything, so the same choice run in
Obsidian continues past the panel. Escape is the only gesture an info panel affords,
so cancelling one just closes it and the run carries on - matching the app.

To end a run deliberately, `POST /abort`. It rejects whatever the run is blocked on
and makes its next prompt fail too, so the run unwinds and delivers its **real**
outcome - usually `{"kind":"error","error":"Input cancelled by user"}`, but `done` if
it had nothing left to interrupt and simply finished. `/abort` never fabricates a
terminal event; keep polling until one arrives. The `interrupted` count tells you
whether it stopped anything.

:::caution[What `/abort` cannot reach]
`/abort` interrupts prompts that were routed **to you**. A run that is mid-work
between prompts keeps going, so `"interrupted":0` means nothing was waiting on you and
the run may still finish and commit its side effects. Keep polling for the terminal
event either way.
:::

### When a reply is rejected

`/reply` answers `400` and leaves the prompt **pending** when it cannot honour
what you sent, so you can correct the reply and POST again. Two cases:

- `cancelled` is present but is not a boolean (`"true"`, `1`, `"no"`). QuickAdd
  will neither abort on a flag it does not recognise nor quietly answer the prompt
  on the user's behalf, so it asks you to fix the flag. Use the literal `true`;
  `false` and omitting it both mean "this is a real answer".
- a `confirm` reply whose `value` is not `true`/`false`. The user never answered,
  and QuickAdd will not invent a "No" for them.

Every other prompt type accepts whatever you send, including an empty answer:
`""` and `[]` are things a user genuinely submits in the app (the Skip buttons,
optional fields), so they must stay legal here too.

A `409` from `/reply` means nothing was waiting on that `requestId`.

Good to know:

- **Desktop only.** The bridge binds to `127.0.0.1`, is gated by the per-session `token`, rejects browser (`Origin`/`Referer`) and non-loopback `Host` requests, and the server is ephemeral - it starts on the first session and stops when the last one ends.
- **Concurrency.** Each run gets its own `sessionId` + `token`; many can run at once without interfering.
- If no client attaches within ~30s the run is aborted so a prompt can't hang forever.

