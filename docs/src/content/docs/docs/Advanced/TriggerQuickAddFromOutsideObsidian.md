---
title: Trigger QuickAdd from outside Obsidian
description: "Launch QuickAdd choices from launchers, shortcuts, and schedulers using the obsidian://quickadd URI or the Obsidian CLI, no extra plugins"
slug: docs/Advanced/TriggerQuickAddFromOutsideObsidian
---

You can run a QuickAdd choice from a launcher, a script, a scheduled job, or a
link in a note - without opening Obsidian and clicking around, and without any
extra plugins. There are two built-in ways in:

- The `obsidian://quickadd` link, for anything that can open a URL.
- The Obsidian CLI, for anything that runs a shell command, like a scheduled job.

You do not need the Advanced URI plugin for this. QuickAdd has its own handler.

## Get the choice ready {#prepare-the-choice}

Before you automate a choice:

1. Give it a unique name. Triggers select by choice name, and if two choices share a name, QuickAdd runs the first match it finds.
2. Use [named values](/docs/FormatSyntax/#named-value) for anything you want to pass in from outside, for example `{{VALUE:entry}}` or `{{VALUE:project}}`.
3. Keep prompts out of scheduled jobs where you can. A scheduled job works best when every required value is passed up front.

You can list your choices from the CLI to confirm names and ids:

```bash
obsidian vault="My Vault" quickadd:list
```

## Build the link {#native-uri-syntax}

Use this shape:

```text
obsidian://quickadd?choice=<encoded choice name>[&value-<name>=<encoded value>]
```

For example:

```text
obsidian://quickadd?vault=My%20Vault&choice=Daily%20log&value-entry=Finished%20review
```

The parts are:

- `choice` - the exact choice name to run. Encode spaces and special characters, so `Daily log` becomes `Daily%20log`.
- `value-<name>` - sets a named QuickAdd value. `value-entry=Done` fills `{{VALUE:entry}}`; `value-log%20notes=Done` fills `{{VALUE:log notes}}`.
- `vault` - which vault to use. Obsidian handles this before QuickAdd sees the link.

Values are used exactly as passed. If a choice should ignore an accidental
leading or trailing space for a value, add `|trim` to the format, for example
`{{VALUE:entry|trim}}`.

Unnamed values like a bare `{{VALUE}}`, `{{NAME}}`, or `{{MVALUE}}` cannot be
filled from the link. QuickAdd prompts for them inside Obsidian as usual.

:::tip
For the full link reference, including callback links like `x-success` and
`x-error`, see [Open QuickAdd from a URI](/docs/Advanced/ObsidianUri/). Callback
support is opt-in and has extra restrictions that ordinary triggers do not need.
:::

## Trigger from a desktop shortcut {#desktop-shortcuts}

Any desktop shortcut or launcher that can open a URL can open
`obsidian://quickadd`.

### macOS {#macos}

Use Shortcuts with an **Open URLs** action, or run:

```bash
/usr/bin/open 'obsidian://quickadd?vault=My%20Vault&choice=Daily%20log'
```

If you use a shell command, quote the whole link. The `&` character has special
meaning in shells unless it is quoted.

### Windows {#windows}

For a desktop shortcut target or launcher command, use:

```bat
cmd.exe /c start "" "obsidian://quickadd?vault=My%20Vault&choice=Daily%20log"
```

The empty `""` is intentional. In `cmd.exe start`, the first quoted string is the
window title, not the command to run.

### Linux {#linux}

Use `xdg-open` from a desktop session:

```bash
xdg-open 'obsidian://quickadd?vault=My%20Vault&choice=Daily%20log'
```

For a `.desktop` launcher, put the command in a small shell script and point
`Exec` at that script. This avoids desktop-file escaping problems with the
percent signs in URL-encoded values:

```sh
#!/usr/bin/env sh
xdg-open 'obsidian://quickadd?vault=My%20Vault&choice=Daily%20log'
```

```ini
[Desktop Entry]
Type=Application
Name=Daily log
Exec=/home/alice/bin/quickadd-daily-log
Terminal=false
```

## Run QuickAdd on a schedule {#run-quickadd-on-a-schedule}

QuickAdd has no built-in background scheduler. Use your operating system's
scheduler to run Obsidian's native CLI command.

Scheduled jobs should use `quickadd:run`:

```bash
obsidian vault="My Vault" quickadd:run choice="Daily log" value-entry="Scheduled check"
```

By default, `quickadd:run` is non-interactive. If the choice is missing a
required input, QuickAdd returns JSON with `missingFlags` instead of opening
prompts. Run `quickadd:check` while building the automation to see what still
needs to be passed. See [QuickAdd CLI](/docs/Advanced/CLI/) for the full command
reference.

```bash
obsidian vault="My Vault" quickadd:check choice="Daily log"
```

If you intentionally want Obsidian to prompt, add `ui` - but only for jobs that
run while you are logged in and able to answer:

```bash
obsidian vault="My Vault" quickadd:run choice="Daily log" ui
```

:::caution
Use full paths in schedulers. They usually do not load the same `PATH` as your
terminal.
:::

### macOS launchd {#macos-launchd}

Use the full path from `command -v obsidian`. In a launchd plist, pass each
argument as its own string:

```xml
<key>ProgramArguments</key>
<array>
  <string>/opt/homebrew/bin/obsidian</string>
  <string>vault=My Vault</string>
  <string>quickadd:run</string>
  <string>choice=Daily log</string>
  <string>value-entry=Scheduled check</string>
</array>
```

Depending on your install, the Obsidian CLI path may be
`/usr/local/bin/obsidian` instead.

### Windows Task Scheduler {#windows-task-scheduler}

Use `Obsidian.com`, not `Obsidian.exe`, for CLI commands:

```text
Program/script:
C:\Users\alice\AppData\Local\Obsidian\Obsidian.com

Arguments:
vault="My Vault" quickadd:run choice="Daily log" value-entry="Scheduled check"
```

For a scheduled URI action instead, run:

```text
Program/script:
cmd.exe

Arguments:
/c start "" "obsidian://quickadd?vault=My%20Vault&choice=Daily%20log"
```

URI actions need a logged-in desktop session. In Task Scheduler, use "Run only
when user is logged on" for URL-opening tasks.

### Linux cron or systemd user timers {#linux-cron-or-systemd-user-timers}

Use the full CLI path:

```cron
0 9 * * * /home/alice/.local/bin/obsidian vault="My Vault" quickadd:run choice="Daily log" value-entry="Scheduled check"
```

Run GUI-related jobs only from your user desktop session. If a cron job cannot
reach your desktop session, prefer a systemd user timer or run the command from
your desktop environment's scheduler.

## Add links and buttons to a note {#in-note-links-and-buttons}

Plain Markdown links work well for dashboard notes:

```markdown
[New idea](obsidian://quickadd?vault=My%20Vault&choice=New%20idea)
[Log work](obsidian://quickadd?vault=My%20Vault&choice=Work%20log&value-project=QuickAdd)
```

Clicking the link runs the choice.

If you use a button plugin for styling, point it at the same
`obsidian://quickadd` link. Another QuickAdd-native option is to enable the
command toggle on the choice, then configure the button to run the generated
Obsidian command for that choice.

## Troubleshooting {#troubleshooting}

- **Nothing happens**: make sure QuickAdd is enabled in the selected vault and that the choice name is encoded and spelled exactly.
- **The wrong choice runs**: rename choices so the externally triggered choice name is unique.
- **A scheduled run returns JSON instead of capturing**: the choice still needs input. Copy each entry from the returned `missingFlags` into your command and replace `<value>` with the value you want to pass.
- **The command works in a terminal but not from a scheduler**: use the full path to the Obsidian CLI, and make sure the job runs in your user desktop session.
- **An older thread suggests `obsidian://advanced-uri?...`**: replace it with `obsidian://quickadd?...`. QuickAdd has its own URI handler.
