---
hidden: true
title: Open QuickAdd from your Desktop
description: Open a specific QuickAdd choice from an AutoHotkey desktop hotkey using Obsidian's native quickadd URI handler
slug: docs/Misc/AHK_OpenQuickAddFromDesktop
---

This older page is kept for existing links. For current desktop shortcuts,
launchers, scheduled jobs, and dashboard links, see
[Trigger QuickAdd from outside Obsidian](/docs/Advanced/TriggerQuickAddFromOutsideObsidian/).

QuickAdd has a native URI handler, so AutoHotkey can open a choice directly:

```ahk
#SingleInstance, Force
SendMode Input
SetWorkingDir, %A_ScriptDir%
SetTitleMatchMode, RegEx

!^+g::
    WinActivate, i) Obsidian
    Run "obsidian://quickadd?vault=My%20Vault&choice=Daily%20log"
Return
```

Replace `My%20Vault` and `Daily%20log` with your URL-encoded vault and choice
names. Remove `WinActivate` if you do not want AutoHotkey to focus Obsidian
before opening the link.
