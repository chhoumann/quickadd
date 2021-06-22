### Bonus - Open QuickAdd from your Desktop
This is an AutoHotkey script which unminimizes/focuses Obsidian and sends some keypresses to it.

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
