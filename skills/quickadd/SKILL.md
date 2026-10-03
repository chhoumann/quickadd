---
name: quickadd
description: Write into an Obsidian vault through the user's own QuickAdd choices (captures, templates, macros) via the Obsidian CLI, instead of editing files by hand. Use when the vault has .obsidian/plugins/quickadd and the user asks to add, log, capture, or create something - a task, a journal or daily-note entry, a meeting or source note - or asks for a new repeatable capture.
---

# QuickAdd

QuickAdd choices are the user's own rules for writing into their vault: which
file, which heading, which template, how the file is named, whether a line is
a task. Running the choice applies all of them. Copying its format by hand
usually misses one (a `- [ ]` checkbox, the template for a new daily note,
Templater processing, the file-name pattern).

When a choice fits the request, run the choice. Write files yourself only when
no choice fits, and say so.

## Requirements

- Obsidian desktop is running with this vault open, and its command line
  interface is on (Settings -> General -> Command line interface).
- Run `obsidian` from inside the vault folder, or pass `vault=<name>` as the
  **first** argument.

## Write through a choice

1. List the choices and what each one writes:

   ```bash
   obsidian quickadd:list
   ```

   Each Template and Capture has a `writes` object read from its settings.
   Pick a choice by what it writes, not only by its name.

   - Capture: `target` (a file; a path ending in `/` means a file in that
     folder, `#tag` a file with that tag, `<active file>` the open note),
     `position` (`top`, `bottom`, `after`, `before`, `cursor`, `newLineAbove`,
     `newLineBelow`, `property`), `line` (the heading or line for
     `after`/`before`), `property`, `format` (the text written), `task`,
     `eachLine` (each line of the value becomes its own entry, so a
     multi-line value writes several entries), and `createWithTemplate`
     (template for a target that doesn't exist yet).
   - Template: `template`, `folder` (`<default>` is Obsidian's default
     location for new notes), `fileName`.
   - Formats are unexpanded: `{{DATE:...}}` in `target` means the file depends
     on the day. `<ask>` means QuickAdd asks the user for that part, so avoid
     those choices unless the user is at Obsidian to answer.

2. Use the choice's `id` from the list from here on. Names can repeat; ids
   can't.

   Ask the choice what inputs it needs:

   ```bash
   obsidian quickadd:check id=<id> fields
   ```

   `missing[].id` is the variable name. Note `type`, `options`,
   `defaultValue`, and `dateFormat`. `value` is the plain `{{VALUE}}` input.

3. Run it non-interactively with every input, and ask for the outcome:

   ```bash
   obsidian quickadd id=<id> vars='{"task":"Review PR","due":"friday"}' verify
   ```

   - Date inputs accept natural language (`friday`, `tomorrow`) or `YYYY-MM-DD`.
   - Multi-line text is fine inside `vars` JSON (`\n`).
   - `"ok":true` means the choice ran. `effect` says what it did: `created` or
     `changed` (and `file` is the note), `unchanged` (nothing was written - tell
     the user why rather than retrying), or `unknown` (QuickAdd could not
     confirm the result, as for every Macro). On `unknown`, look at the note you
     expected to change. Never re-run a choice just because its result is
     unconfirmed: it may already have written.
   - `"ok":false` with `missing` lists inputs you still need to pass.
   - `"aborted":true` means QuickAdd needed to ask the user something (for
     example, a note with that name already exists). Tell the user; don't
     work around it by writing the file yourself.
   - Never add `ui`: it opens prompts in Obsidian that only the user can answer.

Macro choices run the user's scripts. Run a Macro only when the user asked for
exactly that action.

## Create a new choice

When the user wants a new repeatable capture or template ("add a reading log I
can append to"), write a package to a new file in the vault (pick a name that
doesn't exist yet) and import it:

```json
{
  "schemaVersion": 1,
  "quickAddVersion": "2.0.0",
  "createdAt": "2026-01-01T00:00:00Z",
  "rootChoiceIds": ["reading-log"],
  "choices": [
    {
      "choice": {
        "id": "reading-log",
        "name": "Reading log",
        "type": "Capture",
        "command": true,
        "captureTo": "Reading.md",
        "createFileIfItDoesntExist": { "enabled": true },
        "format": { "enabled": true, "format": "- {{DATE}} {{VALUE:book}}: {{VALUE:thought}}\n" },
        "prepend": true
      },
      "pathHint": [],
      "parentChoiceId": null
    }
  ],
  "assets": []
}
```

```bash
obsidian quickadd:package-preview path=reading-log.quickadd.json
obsidian quickadd:package-import path=reading-log.quickadd.json choices=import
```

- Always pass `choices=import`. It only adds new choices: if a choice with the
  same `id` is already in the vault, the import is refused and nothing
  changes. Check the preview first; every choice should show `"exists":false`.
  If one shows `true`, give it a different `id` (and a name that isn't in
  `quickadd:list`). Use `choices=overwrite` only when the user asked you to
  change that choice.
- Settings you leave out get QuickAdd's defaults.
- Capture: `captureTo`, `format`, `insertAfter: {"enabled": true, "after": "## Log"}`,
  `prepend: true` (append to the bottom), `task: true`.
- Template: `templatePath`, `fileNameFormat: {"enabled": true, "format": "..."}`,
  `folder: {"enabled": true, "folders": ["Meetings"]}`.
- Format syntax: `{{VALUE}}`, `{{VALUE:name}}`, `{{VDATE:name,YYYY-MM-DD}}`,
  `{{DATE:YYYY-MM-DD}}`, `{{TIME}}`, `{{LINKCURRENT}}`. Reference:
  https://quickadd.obsidian.guide/docs/FormatSyntax/
- Run the new choice once with `verify`, then delete the package file you
  created (only that one).
