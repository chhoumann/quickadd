# QuickAdd docs captures

QuickAdd-specific fixtures and driver scripts for documentation screenshots and
GIFs. The generic tooling (capture instance, verified window/theme/font setup,
DPR-accurate crops, real-time recording, GIF conversion) is `obsidian-e2e
capture`; see its README section "Screenshots And Recordings". Nothing here is
a test suite or required workflow: copy a script, change it, run it.

## One-time setup (Linux orb)

`.agents/setup` installs Obsidian, Xvfb, `fonts-inter` and `gifsicle`
(`ffmpeg` ships with orbs). Build the plugin first: `pnpm run build`.

```bash
# A throwaway capture vault with the plugin build linked and the demo fixture.
pnpm exec obsidian-e2e provision --root /tmp/qa-capture --vault Notes \
  --data .agents/capture/demo-data.json
rm /tmp/qa-capture/Notes/.obsidian/core-plugins.json   # [] disables the command palette
printf '# Inbox\n\n- Buy oat milk\n' > /tmp/qa-capture/Notes/Inbox.md

# A dedicated instance (never the E2E test instance) on CDP port 9333, DPR 2.
eval "$(pnpm exec obsidian-e2e capture launch --vault /tmp/qa-capture/Notes --print-env)"
amp orb service start quickadd-capture \
  --command "$PWD/node_modules/.bin/obsidian-e2e capture launch --vault /tmp/qa-capture/Notes"
HOME=$OBSIDIAN_E2E_CAPTURE_HOME obsidian vault=Notes plugins:restrict off

pnpm exec obsidian-e2e capture prepare --width 1280 --height 800 --scale 2 \
  --theme light --font Inter --hide-secret-warning
```

After `pnpm run build`, reload the plugin in the capture instance with
`HOME=$OBSIDIAN_E2E_CAPTURE_HOME obsidian vault=Notes plugin:reload id=quickadd`,
then re-run `capture prepare` (any app reload drops the injected capture CSS).

## Recipes

- **GIF of a flow**: `pnpm exec obsidian-e2e capture record inbox.webm --cursor -- .agents/capture/record-inbox-capture.sh`,
  then `capture sheet inbox.webm review.png` to review and
  `capture gif inbox.webm docs/src/content/docs/docs/Images/<name>.gif`.
  The script asserts the note really changed; if anything fails (or you
  Ctrl-C) the take is discarded and an existing file is left untouched.
  On the capture instance's Xvfb display the recorder uses x11grab: use the
  default `--fps 10` for GIFs and heavy views, `--fps 30` for a smooth WebM.
  Keep the window's size fixed during a take (no `prepare` inside the driver)
  and keep the Settings popout closed, or the take is rejected.
- **Typing**: use `capture type "..."` (one in-page call per string, paced
  and real-time) rather than one `agent-browser` call per key.
- **Active modal** (prompts, suggesters, choice builders):
  `capture screenshot out.png --modal --pad 16 --clean`. For tall builders:
  `capture prepare --height 1900` and add `--expand`.
- **Crop a builder up to a setting**: `--rect-js` with the in-page helpers, e.g.
  ending just above the "Behavior" heading row:

  ```bash
  pnpm exec obsidian-e2e capture screenshot out.png --clean --rect-js '(() => {
    const c = __obsidianE2ECapture, m = c.rect(c.modal()), r = c.rect(c.settingItem("Behavior"));
    return { x: m.x, y: m.y, width: m.width, height: r.y - m.y - 4 }; })()'
  ```

- **Settings**: `app.setting.open(); app.setting.openTabById("quickadd")`, then
  `--modal`. If Settings opens as a popout window, add `--window Settings`
  to `prepare`/`screenshot`.

## QuickAdd gotchas

- Seed choices through `data.json` before launch (`demo-data.json`), or edit
  them through the UI. Direct runtime writes to `plugin.settings` can be
  overwritten by the settings store; `plugin:reload` if that happens.
- Hand-written choices need every nested object QuickAdd expects: a Capture
  choice without `insertAfter` fails with "Cannot read properties of undefined
  (reading 'enabled')".
- Capture `prepend: true` means **append to the bottom** (legacy name).
- Do not press Escape to dismiss a suggester inside a builder: it closes the
  builder. Use `--clean` on the screenshot instead.
- Keep API keys out of recordings: select them from Keychain rather than typing.
- Disable Obsidian Sync in the capture vault if its red status icon shows:
  `app.internalPlugins.plugins.sync.disable(true)`.

Desktop mobile-layout captures (`app.emulateMobile(true)` plus a phone-sized
`prepare`) show the mobile layout inside desktop Obsidian. They are not
real-device captures; real mobile hardware testing runs on `agents-fsn1`.
