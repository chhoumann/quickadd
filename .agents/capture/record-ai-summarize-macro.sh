#!/usr/bin/env bash
# Build the AIAssistant.md "Summarize selection" macro from the "Run a sequence
# of steps" preset, then run it on a selected paragraph, for
# docs/src/content/docs/docs/Images/AI_Assistant_Macro.gif.
#
# Vault: the AI Assistant set up as in AIAssistant.md's Setup (prompt template
# folder "AI prompts" holding Summarize.md with {{SELECTED}}, a default model, a
# linked key) and an open note whose first line is the paragraph to summarize.
# ai-demo-data.json does that against ai-demo-stub.mjs, a local
# OpenAI-compatible server with a canned reply, so no API key is needed:
#
#   node .agents/capture/ai-demo-stub.mjs &
#   pnpm exec obsidian-e2e provision --root /tmp/qa-capture --vault Notes \
#     --data .agents/capture/ai-demo-data.json
#   # add AI prompts/Summarize.md and the note, launch and prepare as in
#   # README.md, store any value as the "local-demo-api-key" secret, then:
#   obsidian-e2e capture record ai.webm --cursor -- .agents/capture/record-ai-summarize-macro.sh
set -euo pipefail

: "${OBSIDIAN_E2E_CDP_PORT:?run under obsidian-e2e capture record}"
: "${OBSIDIAN_E2E_CAPTURE_VAULT_PATH:?export the capture launch --print-env output}"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-quickadd-capture}"
ab() { agent-browser --cdp "$OBSIDIAN_E2E_CDP_PORT" "$@" >/dev/null; }
cap() { obsidian-e2e capture "$@"; }
# Move the pointer to the element a JS expression returns and click it.
click() {
	local xy x y
	xy=$(agent-browser --cdp "$OBSIDIAN_E2E_CDP_PORT" eval "(() => { const el = ($1); if (!el) return 'NONE'; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ' ' + Math.round(r.y + r.height / 2); })()" | tail -n 1 | tr -d '"')
	[[ "$xy" != NONE ]] || { echo "Nothing to click: $1" >&2; exit 1; }
	read -r x y <<<"$xy"
	ab mouse move "$x" "$y"
	sleep 0.35
	ab mouse down
	ab mouse up
}
hover() {
	local xy x y
	xy=$(agent-browser --cdp "$OBSIDIAN_E2E_CDP_PORT" eval "(() => { const r = ($1).getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ' ' + Math.round(r.y + r.height / 2); })()" | tail -n 1 | tr -d '"')
	read -r x y <<<"$xy"
	ab mouse move "$x" "$y"
	sleep 0.5
}
pane='document.querySelector(".vertical-tab-content")'
row() { echo "[...document.querySelectorAll('.modal-container .setting-item')].reverse().find((s) => s.querySelector('.setting-item-name')?.textContent.trim() === '$1')"; }
note="$OBSIDIAN_E2E_CAPTURE_VAULT_PATH/Projects/Launch sync.md"
before=$(grep -c "" "$note")

ab eval 'app.workspace.openLinkText("Projects/Launch sync", "", false).then(() => app.workspace.activeEditor?.editor?.blur?.())'
ab mouse move 1180 740
sleep 1.5
ab eval 'app.setting.open(); app.setting.openTabById("quickadd"); 0'
sleep 1.2
click "[...$pane.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New choice')"
sleep 0.8
click "[...document.querySelectorAll('.menu .menu-item')].find((i) => i.textContent.startsWith('Run a sequence of steps'))"
sleep 1.2
click "$(row Name).querySelector('input')"
ab press Control+a
cap type "Summarize selection" --delay 45
sleep 0.6

click "$pane.querySelector('[aria-label=\"Add AI Assistant command\"]')"
sleep 0.8
click "$pane.querySelector('[aria-label=\"Configure AI Assistant\"]')"
sleep 1
click "$(row 'Prompt template').querySelector('.checkbox-container')"
sleep 0.4
click "$(row 'Prompt template').querySelector('input[type=text], input:not([type])')"
cap type "Summ" --delay 90
sleep 0.8
click "[...document.querySelectorAll('.suggestion-container .suggestion-item')].find((i) => i.textContent.includes('Summarize'))"
sleep 0.6
click "$(row 'Output variable name').querySelector('input')"
ab press Control+a
cap type "summary" --delay 70
sleep 0.8
click "[...[...document.querySelectorAll('.modal-container')].pop().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save')"
sleep 0.8

click "$pane.querySelector('[aria-label=\"Add Capture choice\"]')"
sleep 0.8
click "$pane.querySelector('[aria-label=\"Configure Untitled Capture Choice\"]')"
sleep 1
click "$(row Name).querySelector('input')"
ab press Control+a
cap type "Append summary" --delay 45
sleep 0.4
click "$(row 'Capture to active file').querySelector('.checkbox-container')"
sleep 0.6
hover "$(row 'Write position').querySelector('select')"
ab select ".vertical-tab-content select:has(option[value=activeTop])" bottom
sleep 0.8
click "$(row 'Capture format').querySelector('textarea')"
cap type "{{VALUE:summary}}" --delay 70
sleep 0.8
click "$(row 'Capture format').querySelector('.setting-item-name')"
sleep 0.6
click "$pane.querySelector('.setting-page-back-button')"
sleep 1.2
click "$pane.querySelector('.setting-page-back-button')"
sleep 1.2
click "document.querySelector('.modal.mod-settings .modal-header-button, .modal.mod-settings .modal-close-button')"
sleep 1

# Select the paragraph and run the macro on it.
ab eval '(() => { const e = app.workspace.activeEditor.editor; e.focus(); e.setSelection({ line: 0, ch: 0 }, { line: 0, ch: e.getLine(0).length }); })()'
sleep 1.2
ab press Control+p
sleep 0.5
cap type "QuickAdd: Run" --delay 60 --selector ".prompt-input"
sleep 0.5
ab press Enter
sleep 0.9
cap type "summ" --delay 90 --selector ".prompt-input"
sleep 0.5
ab press Enter

# Verify the product behaviour: the model's reply is a new last line.
for _ in $(seq 1 50); do
	(( $(grep -c "" "$note") > before )) && break
	sleep 0.2
done
(( $(grep -c "" "$note") > before )) && [[ -n "$(tail -n 1 "$note")" ]] || {
	echo "The macro did not append a summary to $note" >&2
	exit 1
}
ab eval 'app.workspace.activeEditor?.editor?.blur?.()'
sleep 3
