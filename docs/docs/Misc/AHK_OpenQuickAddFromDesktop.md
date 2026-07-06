---
hidden: true
title: Open QuickAdd from your Desktop
---

This older page is kept for existing links. For current desktop shortcuts,
launchers, scheduled jobs, and dashboard links, use
[Trigger QuickAdd from outside Obsidian](../Advanced/TriggerQuickAddFromOutsideObsidian.md).

QuickAdd now has a native URI handler, so AutoHotkey can open QuickAdd directly:

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
before opening the URI.
