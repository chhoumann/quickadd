---
title: QuickAdd API Utility Module
---
# Utility Module
Given by `api.utility`.

### ``getClipboard(): Promise<string>``
Returns the contents of your clipboard.

This function is asynchronous. You should ``await`` it.

Syntax: `await quickAddApi.utility.getClipboard();`

### ``setClipboard(text: string): Promise``
Sets the contents of your clipboard to the given input.

This function is asynchronous. You should ``await`` it.

Syntax: `await quickAddApi.utility.setClipboard();`
