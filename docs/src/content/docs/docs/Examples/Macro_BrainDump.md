---
title: "Macro: Brain dump"
description: Jot down several inbox entries in a row - a macro opens your Capture again after each entry until you press Esc
slug: docs/Examples/Macro_BrainDump
package: brain-dump
---

When ideas come faster than you can file them, a Capture that closes after
every entry slows you down. This macro opens your **Add to inbox** Capture
again after each entry: type, press Enter, type the next one, and press Esc
when you're done. Every entry becomes its own line in `Inbox.md`.

This example needs QuickAdd 2.29.0 or later. In earlier versions, each new
prompt opened with the entry you had just saved.

![Running Brain dump from the command palette: three entries are typed one after another, each prompt opens empty, each entry appears as a new line in Inbox, and Esc closes the last prompt](../Images/examples/macro-brain-dump.gif)

## Setup

Imported the package above? It adds the **Add to inbox** Capture, the
**Brain dump** macro, and `scripts/brainDump.js`. Follow **After importing**
in the card, then skip to [What you get](#what-you-get).

1. Create the Capture. In **Settings → QuickAdd**, click **New choice** →
   **Capture**. Click its name at the top of the settings window and rename it
   `Add to inbox`.
2. Set **Capture to** to `Inbox.md` and turn on **Create file if it doesn't
   exist**.
3. Set **Write position** to **Bottom of file**.
4. Turn on **Capture format** and enter:

   ```text
   - {{VALUE}}
   ```

   Click **Done**.
5. <a href="/scripts/brainDump.js" download>Download brainDump.js</a> and save
   it in your vault, anywhere except the `.obsidian` folder.
6. Click **New choice** → **Macro** and rename it `Brain dump`. In the Macro
   builder, type `brainDump` in the **User scripts** box, pick the script, and
   click **Add**.
7. Turn **Add to command palette** on and click **Done**.

## What you get

Run **QuickAdd: Brain dump** from the command palette. A prompt titled **Text
to capture** opens. Type an entry and press Enter: QuickAdd adds it to
`Inbox.md` and opens an empty prompt for the next one. Press Esc to stop.
Nothing is written for the prompt you close.

After three entries, `Inbox.md` ends like this:

```markdown
- Try a thinner sage glaze on the rims
- Price the espresso cups for Blue Harbor
- Ask Jonas if the saucers need a foot ring
```

## Repeat a different Capture

The macro can repeat any Capture that asks for input, such as one that adds a
task to today's daily note. Click the cog next to **Brain dump**, then the cog
on the **brainDump** step, and enter that Capture's name in **Capture choice**.

If the Capture you name doesn't ask for anything, the macro runs it once and
stops with a notice, so it can't keep writing the same line.

The script is short enough to adapt:

```js
// Each entry runs the Capture once. Press Esc (or Cancel) to stop.
while (true) {
	const started = Date.now();
	await params.quickAddApi.executeChoice(choice);

	// A Capture that never asks for input would repeat forever.
	if (Date.now() - started < 300) return;
}
```

`executeChoice` rejects when you cancel the prompt, which ends the loop. The
[QuickAdd API](/docs/QuickAddAPI/) page shows how to pass variables to the
Capture.
