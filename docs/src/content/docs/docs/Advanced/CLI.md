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
The [Raycast extension](/docs/Advanced/RaycastExtension/) is built on these
commands, so you can run choices from Raycast without typing any.

## What you need {#requirements}

- Obsidian `1.12.2` or newer (the plugin CLI handler API arrived in `1.12.2`).
- QuickAdd enabled in the target vault.

## The commands {#commands}

### Run a choice: `quickadd` / `quickadd:run` {#quickadd--quickaddrun}

Run a QuickAdd choice from the CLI, by name or by id:

```bash
obsidian vault=dev quickadd choice="Daily log"
obsidian vault=dev quickadd:run id="choice-id"
obsidian vault=dev quickadd:run choice="Weekly review" date=lw
```

`date=` is the day for `{{DATE}}`. Pass a real day (`2026-08-21`,
`last friday`, `lw`) and the choice's Which day setting is skipped. Pass
`ask` to open the date picker instead.

`current=` names the run's current note (QuickAdd 2.32.0 or later). By default
that is the active tab, which a run started from outside Obsidian cannot see.
Pass a vault path (`.md` may be omitted) and every part of the run that reads
the current note uses that note instead: **Capture to active file**, **Append
link**, `{{LINKCURRENT}}`, `{{LINKSECTION}}`, `{{FILENAMECURRENT}}`,
`{{FOLDERCURRENT}}`, `{{SELECTED}}`, and a Template's **Same folder as current
file**. Pass `none` to run without a current note.

```bash
obsidian vault=dev quickadd:run choice="Add to today" value-value="Call Sam" current="Daily/2026-10-07"
obsidian vault=dev quickadd:run choice="Inbox" value-value="Idea" current=none
```

- A path with no note returns `{"ok":false,"error":"No note at '…'."}` before anything runs.
- When the named note is not open in the active editor, QuickAdd writes through
  the vault: a capture at the **Cursor** position goes to the top of the note
  (the bottom when the choice captures to the bottom), an appended link goes on
  a new last line (or into its frontmatter property), `{{LINKSECTION}}` links to
  the note without a heading, and `{{SELECTED}}` is empty.
- With `none`, a choice that requires the current note fails the way it does
  with no file open, and an optional link or token is left empty.
- Macro scripts that call `app.workspace.getActiveFile()` themselves are not
  affected; `current=` only changes what QuickAdd resolves.

`current=` is also accepted by `quickadd:run-template`, `quickadd:check`, and
`quickadd:interactive`.

### List your choices: `quickadd:list` {#quickaddlist}

List every QuickAdd choice (including nested choices inside multis):

```bash
obsidian vault=dev quickadd:list
obsidian vault=dev quickadd:list type=Capture
obsidian vault=dev quickadd:list commands
```

Each Template and Capture carries a `writes` object that says what it writes,
read from its settings (QuickAdd 2.30.0 or later). You (or an agent) can tell
choices apart without opening them:

```json
{"name":"Daily log","type":"Capture","currentNote":"none","writes":{"target":"Daily/{{DATE:YYYY-MM-DD}}.md","position":"after","line":"## Log","format":"- {{TIME}} {{VALUE}}\n","createWithTemplate":"Templates/Daily.md"}}
{"name":"Meeting note","type":"Template","currentNote":"optional","writes":{"template":"Templates/Meeting.md","folder":"Meetings","fileName":"{{DATE}} {{VALUE:topic}}"}}
```

Every choice also carries `currentNote` (QuickAdd 2.32.0 or later), which says
whether the choice uses the current note, so a caller knows when to pass
`current=`: `required` when the run fails without one (**Capture to active
file**, a required **Append link**, a `{{LINKCURRENT}}`-style token, **Same
folder as current file**), `optional` when something is left empty without one
(an optional **Append link** and the tokens it makes optional, `{{SELECTED}}`),
and `none` otherwise. Macros and Multis are always `none`. The same key is in
the `choice` summary that `quickadd:check`, `quickadd:run`, and
`quickadd:interactive` return.

| Capture key | Meaning |
| --- | --- |
| `target` | The **Capture to** value, or `<active file>` |
| `position` | `top`, `bottom`, `after`, `before`, `cursor`, `newLineAbove`, `newLineBelow`, or `property`, matching **Write position** |
| `line` | The line for `after` or `before` |
| `property` | The property a `property` capture writes |
| `format` | The text written: the **Capture format**, or `{{VALUE}}` when it is empty (before QuickAdd 2.30.0: when its toggle is off) |
| `task` | `true` when the capture is written as a task |
| `eachLine` | `true` when [**One entry per line**](/docs/Choices/CaptureChoice/#one-entry-per-line) is on: each line of `{{VALUE}}` becomes its own entry (QuickAdd 2.30.0 or later) |
| `createWithTemplate` | The template for a target file that doesn't exist yet |

| Template key | Meaning |
| --- | --- |
| `template` | The template file |
| `folder` | The folder the note goes in; `<default>` is Obsidian's default location for new notes |
| `fileName` | The **File name**, or `{{VALUE}}` when it is empty (before QuickAdd 2.30.0: when the **File name format** toggle is off) |

Formats are shown unexpanded. `<ask>` means QuickAdd asks for that part when the
choice runs. Macros and Multis have no `writes`.

### See what a choice still needs: `quickadd:check` {#quickaddcheck}

Check which inputs are still missing before a non-interactive run:

```bash
obsidian vault=dev quickadd:check choice="Daily log"
```

### Suggest links and tags: `quickadd:suggest` {#quickaddsuggest}

List what Obsidian's own `[[` link or `#` tag suggester offers, so another app can complete links and tags the way the editor does:

```bash
obsidian vault=dev quickadd:suggest kind=links
obsidian vault=dev quickadd:suggest kind=links source="Daily/2026-10-04.md"
obsidian vault=dev quickadd:suggest kind=tags
```

- `kind=links` returns one item per linkable file and per alias, newest first, with files in Obsidian's **Excluded files** list last. `text` is what goes inside `[[...]]` (`Plan`, `Projects/Meeting` when two notes share a name, `Plan|Big Plan` for an alias), `path` is the file, and `alias` is set on alias items. Pass `source=<note path>` when you know which note the link goes into: under the **Relative path to file** link format the text depends on it; without `source` the text is computed from the vault root.
- `kind=tags` returns `{"tag":"work","count":3}` items, most used first, without the `#`.

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

### Save a clipboard image: `quickadd:save-clipboard-image` {#quickaddsave-clipboard-image}

Save a 1x1 PNG through the same path QuickAdd uses when you paste an image into a prompt or when `{{CLIPBOARD}}` falls back to an image. Useful for checking attachment naming without driving a modal.

```bash
obsidian vault=dev quickadd:save-clipboard-image \
  sourcePath="Meetings/Meeting notes.md" \
  nameAfterNoteTitle=true
```

- `sourcePath=` is the note the attachment belongs to (the capture destination). Empty uses vault-root attachment placement and the timestamp name even when title-naming is on.
- `nameAfterNoteTitle=` overrides the **Name pasted images after the note title** setting for this save. Omit it to use the setting.

### Preview and import a package: `quickadd:package-preview` / `quickadd:package-import` {#quickaddpackage-import}

Review a [package](/docs/Choices/Packages/) as JSON, or install it with the
import modal's default decisions:

```bash
obsidian vault=dev quickadd:package-preview path=path/to/package.quickadd.json
obsidian vault=dev quickadd:package-import path=path/to/package.quickadd.json acknowledge=true
```

A package that runs code is refused until you pass `acknowledge=true`. See
[Preview a package from the command line](/docs/Choices/Packages/#preview-from-the-command-line)
for the other options. `quickadd:package-import` needs QuickAdd 2.28.0 or later.

### Check an AI provider: `quickadd:ai-test-connection` {#quickaddai-test-connection}

Check that an [AI provider](/docs/AIAssistant/#add-a-provider) accepts its
linked key. This is the provider page's **Test connection** button:

```bash
obsidian vault=dev quickadd:ai-test-connection provider=openai
```

- `provider=` is the provider's ID, such as `openai`, or its name. The ID must
  match exactly; the name can be in any case.
- A working key returns `"ok":true` and the number of models the provider
  lists:

  ```json
  {"command":"quickadd:ai-test-connection","provider":"openai","ok":true,"modelCount":64,"apiKeyLinked":true}
  ```

  A rejected key returns `"ok":false` with the provider's error.
- An unknown or missing `provider=` returns `"ok":false` and lists the
  provider IDs you can use.
- The output never contains the key. This command needs QuickAdd 2.28.0 or
  later.

## Let an AI agent write through your choices {#agents}

Coding agents such as Claude Code and Codex can edit your vault's files
directly, but then they copy your conventions by hand and sometimes miss one.
QuickAdd ships an [agent skill](https://github.com/chhoumann/quickadd/tree/master/skills/quickadd)
that tells an agent to list your choices, check their inputs, and run them
with `verify` instead. It can also create a new choice for you by importing a
package.

Install it into your vault:

```bash
npx skills add chhoumann/quickadd
```

Or copy `skills/quickadd/SKILL.md` into your agent's skills folder, such as
`.claude/skills/quickadd/` in your vault.

The skill needs QuickAdd 2.30.0 or later: it picks a choice by the `writes`
object that [`quickadd:list`](#quickaddlist) shows.

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

For [property captures](/docs/Choices/CaptureChoice/#property), `vars` preserves
native numbers, checkboxes, and lists when the Capture format is one whole token:

```bash
obsidian vault=dev quickadd choice="Add project tags" \
  vars='{"tags":["Research, writing","work"]}' verify=true
```

`verify=true` includes the engine's [confirmed outcome](#verified-and-effect),
so automation can distinguish a changed property from an unchanged capture.

For Template choices, passing `value` supplies the new note's name. It does not
select an existing note from the discovery picker. The generated path follows
the choice's file-exists behavior. To use **When selecting an existing note**,
run interactively and select the offered note in the discovery prompt.

### Names the CLI reserves {#reserved-flag-names}

The bare `key=value` form (pattern 2) ignores names that a command already uses
as flags or selectors: `choice`, `id`, `vars`, `ui`, `verify`, `date`,
`current` (on `quickadd` / `quickadd:run`), `fields` (on `quickadd:check`), and
`path` (on `quickadd:run-template`). If a choice has a variable named after one of these
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
values containing commas remain unambiguous.

A `form` field that picks notes (a Capture target, a `{{FILE:...}}` field) has
`"type":"suggester"` like any other pick list, plus `"picker":"file"` (QuickAdd
2.31.0 and later); other fields omit `picker`. QuickAdd's own form starts a note
picker empty unless the field has a `defaultValue`, and does not submit while a
required single-note picker (not `optional`, not `multiSelect`) has no pick.
Other pick lists have no such rule.

The run's outcome arrives as the
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
