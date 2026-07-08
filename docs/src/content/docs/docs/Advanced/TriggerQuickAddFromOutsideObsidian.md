---
title: Trigger QuickAdd from outside Obsidian
description: "Launch QuickAdd choices from launchers, shortcuts, and schedulers using the obsidian://quickadd URI or the Obsidian CLI, no extra plugins"
slug: docs/Advanced/TriggerQuickAddFromOutsideObsidian
---

You can trigger QuickAdd from launchers, scripts, schedulers, and dashboard
notes - no extra plugins needed. There are two built-in ways in:

- The `obsidian://quickadd` URI, for anything that can open a link.
- The Obsidian CLI, for anything that runs a shell command, such as a
  scheduled job.

You do not need the Advanced URI plugin to run a QuickAdd choice.

## Prepare the choice

Before you automate a choice:

1. Give the choice a unique name. URI triggers select by choice name, and if more
   than one choice has that name, QuickAdd runs the first match it finds.
2. Use named values for anything you want to pass from outside Obsidian, for
   example `{{VALUE:entry}}` or `{{VALUE:project}}`.
3. Keep prompts out of scheduled jobs where possible. Scheduled jobs work best
   when every required value is passed up front.

Using the Obsidian CLI, you can list choices to confirm names and IDs:

```bash
obsidian vault="My Vault" quickadd:list
```

## Native URI syntax

Use this URI shape:

```text
obsidian://quickadd?choice=<encoded choice name>[&value-<name>=<encoded value>]
```

Example:

```text
obsidian://quickadd?vault=My%20Vault&choice=Daily%20log&value-entry=Finished%20review
```

The URI parameters are:

- `choice` - the exact choice name to run. Encode spaces and special characters,
  for example `Daily log` becomes `Daily%20log`.
- `value-<name>` - sets a named QuickAdd value. `value-entry=Done` fills
  `{{VALUE:entry}}`; `value-log%20notes=Done` fills `{{VALUE:log notes}}`.
- `vault` - the Obsidian vault selector. This is handled by Obsidian before
  QuickAdd receives the URI.

Values are used exactly as passed. If a choice should ignore accidental leading
or trailing whitespace for a value, use `|trim` in the choice format, for
example `{{VALUE:entry|trim}}`.

Unnamed values such as bare `{{VALUE}}`, `{{NAME}}`, and `{{MVALUE}}` cannot be
filled by URI parameters. QuickAdd prompts for them inside Obsidian as usual.

For the full URI reference, including callback URLs such as `x-success` and
`x-error`, see
[Open QuickAdd from a URI](/docs/Advanced/ObsidianUri/). Callback support is opt-in and has
extra restrictions that ordinary triggers do not need.

## Desktop shortcuts

Any desktop shortcut or launcher that can open a URL can open
`obsidian://quickadd`.

### macOS

Use Shortcuts with an **Open URLs** action, or run:

```bash
/usr/bin/open 'obsidian://quickadd?vault=My%20Vault&choice=Daily%20log'
```

If you use a shell command, quote the whole URI. The `&` character has special
meaning in shells unless it is quoted.

### Windows

For a desktop shortcut target or launcher command, use:

```bat
cmd.exe /c start "" "obsidian://quickadd?vault=My%20Vault&choice=Daily%20log"
```

The empty `""` is intentional. In `cmd.exe start`, the first quoted string is the
window title, not the command to run.

### Linux

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

## Run QuickAdd on a schedule

QuickAdd does not include a background scheduler. Use your operating system's
scheduler to run Obsidian's native CLI command.

Scheduled jobs should use `quickadd:run`:

```bash
obsidian vault="My Vault" quickadd:run choice="Daily log" value-entry="Scheduled check"
```

By default, `quickadd:run` is non-interactive. If the choice is missing required
inputs, QuickAdd returns JSON with `missingFlags` instead of opening prompts.
Run `quickadd:check` while building the automation to see what still needs to be
passed. See [QuickAdd CLI](/docs/Advanced/CLI/) for the full command reference.

```bash
obsidian vault="My Vault" quickadd:check choice="Daily log"
```

If you intentionally want Obsidian prompts, add `ui`, but only do this for jobs
that run while you are logged in and able to answer the prompts:

```bash
obsidian vault="My Vault" quickadd:run choice="Daily log" ui
```

Use full paths in schedulers. They usually do not load the same `PATH` as your
terminal.

### macOS launchd

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

### Windows Task Scheduler

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

### Linux cron or systemd user timers

Use the full CLI path:

```cron
0 9 * * * /home/alice/.local/bin/obsidian vault="My Vault" quickadd:run choice="Daily log" value-entry="Scheduled check"
```

Run GUI-related jobs only from your user desktop session. If a cron job cannot
reach your desktop session, prefer a systemd user timer or run the command from
your desktop environment's scheduler.

## In-note links and buttons

Plain Markdown links work well for dashboard notes:

```markdown
[New idea](obsidian://quickadd?vault=My%20Vault&choice=New%20idea)
[Log work](obsidian://quickadd?vault=My%20Vault&choice=Work%20log&value-project=QuickAdd)
```

Clicking the link runs the choice.

If you use a button plugin for styling, configure it to open the same
`obsidian://quickadd` URI. Another QuickAdd-native option is to enable the
command toggle on the choice, then configure the button to run the generated
Obsidian command for that choice.

## Troubleshooting

- Nothing happens: make sure QuickAdd is enabled in the selected vault and that
  the choice name is encoded and spelled exactly.
- The wrong choice runs: rename choices so the externally triggered choice name
  is unique.
- A scheduled run returns JSON instead of capturing: the choice still needs
  input. Copy each entry from the returned `missingFlags` into your command and
  replace `<value>` with the value you want to pass.
- The command works in a terminal but not from a scheduler: use the full path to
  the Obsidian CLI and make sure the job runs in your user desktop session.
- An older thread suggests `obsidian://advanced-uri?...`: replace it with
  `obsidian://quickadd?...`. QuickAdd has its own URI handler.
