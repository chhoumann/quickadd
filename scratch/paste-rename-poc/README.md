# Throwaway POC for issue 1703

This folder is not production code. It exists so you can feel four paste-rename interactions and pick one before anyone touches `src/`.

Open `index.html` in a browser, or run `python3 -m http.server 8765 --bind 127.0.0.1` from this folder and visit `http://127.0.0.1:8765`.

Run the algorithm against the plugin's own README examples:

```
node scenarios.mjs
```

The engine is a port of [obsidian-paste-image-rename 1.6.1](https://github.com/reorx/obsidian-paste-image-rename) (`generateNewName`, `deduplicateNewName`, `renderTemplate`). `{{VALUE}}` is the only QuickAdd-only token.

## Variants

- **Today.** What QuickAdd already writes: `Clipboard image YYYY-MM-DD HH.MM.SS.png`.
- **Silent title.** Name the file as the capture destination stem at write time. Collision suffix `-1`, `-2`.
- **Confirm modal.** The plugin's default. Save as `Pasted image …`, then a rename dialog.
- **Pattern.** Plugin auto-rename, but at write time, with QuickAdd's `{{VALUE}}` added.
