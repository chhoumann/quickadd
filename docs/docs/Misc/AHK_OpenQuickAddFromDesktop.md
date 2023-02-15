---
hidden: true
title: Open QuickAdd from your Desktop
---

This is an [AutoHotkey](https://www.autohotkey.com/) script which unminimizes/focuses Obsidian and sends some keypresses to it.

I've bound this to my QuickAdd activation hotkey, so this script automatically brings Obsidian to the front of my screen with QuickAdd open.

```ahk
#SingleInstance, Force
SendMode Input
SetWorkingDir, %A_ScriptDir%
SetTitleMatchMode, RegEx

!^+g::
    WinActivate, i) Obsidian
    ControlSend,, {CtrlDown}{AltDown}{ShiftDown}G{CtrlUp}{CtrlUp}{ShiftUp}, i)Obsidian
Return
```

I'm using CTRL+SHIFT+ALT+G as my shortcut, both in Obsidian and for the AHK script to activate. I use a keyboard shortcut to send those keys (lol, I know - but it's to avoid potential conflicts).
Here's a guide to what the `!^+` mean, and how you can customize it: https://www.autohotkey.com/docs/Hotkeys.htm

#### Update

If you are willing to install the `Obsidian Advanced URI` plugin, this script is much easier for you to use.

```ahk
SendMode Input
SetWorkingDir, %A_ScriptDir%
SetTitleMatchMode, RegEx

!^+g::
    WinActivate, i) Obsidian

    Run "obsidian://advanced-uri?vault=<YOUR_VAULT_NAME>&commandname=QuickAdd: Run QuickAdd"
Return
```

Simply replace `<YOUR_VAULT_NAME>` with the name of your vault.

**This version is more reliable**, as the other one can fail to activate occasionally.

It uses the same hotkey to activate as above (`CTRL+SHIFT+ALT+G`). If you wish to change it:

-   `!` means `Alt`
-   `^` means `Ctrl`
-   `+` means `Shift`

So, you can replace the `!^+g` with any hotkey of your choosing.
