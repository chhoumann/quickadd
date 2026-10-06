#!/usr/bin/env bash
# Drive the Getting Started "Add to journal" Capture choice the way a user would,
# for docs/src/content/docs/docs/Images/getting-started-add-to-journal.gif.
# journal-data.json holds the choice as the page's steps make it from the
# "Add to a note" preset, next to the Task, New note and Log presets.
#
#   pnpm exec obsidian-e2e provision --root /tmp/qa-capture --vault Notes \
#     --data .agents/capture/journal-data.json
#   rm /tmp/qa-capture/Notes/.obsidian/core-plugins.json   # the defaults, command palette included
#   mkdir -p /tmp/qa-capture/Notes/{Areas,Journal,Meetings,People,Projects,Templates}
#   printf -- '- 08:10 Morning run along the harbour, 5 km\n- 08:45 Coffee and weekly planning\n' \
#     > "/tmp/qa-capture/Notes/Journal/$(date +%F).md"
#   # launch and prepare as in README.md, open the file explorer, then:
#   obsidian-e2e capture record journal.webm --cursor -- .agents/capture/record-add-to-journal.sh
set -euo pipefail

: "${OBSIDIAN_E2E_CDP_PORT:?run under obsidian-e2e capture record}"
: "${OBSIDIAN_E2E_CAPTURE_VAULT_PATH:?export the capture launch --print-env output}"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-quickadd-capture}"
ab() { agent-browser --cdp "$OBSIDIAN_E2E_CDP_PORT" "$@" >/dev/null; }
cap() { obsidian-e2e capture "$@"; }
text="Standup moved to Wednesday"
journal="$OBSIDIAN_E2E_CAPTURE_VAULT_PATH/Journal/$(date +%F).md"
[[ -f "$journal" ]] || { echo "Seed $journal with a few entries first" >&2; exit 1; }
before=$(grep -c "" "$journal")

ab eval "app.workspace.openLinkText('Journal/$(date +%F)', '', false).then(() => app.workspace.activeEditor?.editor?.blur?.())"
ab mouse move 1180 740
sleep 1.5
ab press Control+p
sleep 0.5
cap type "QuickAdd: Run" --delay 60 --selector ".prompt-input"
sleep 0.5
ab press Enter
sleep 0.9
cap type "jour" --delay 90 --selector ".prompt-input"
sleep 0.5
ab press Enter
sleep 0.8
cap type "$text" --delay 45
sleep 0.6
ab press Enter

# Verify the product behaviour, not just the pixels: the entry is a new last
# line of today's journal note, as the Getting Started page says.
entry="^- [0-9]{2}:[0-9]{2} $text\$"
for _ in $(seq 1 30); do
	(( $(grep -c "" "$journal") > before )) && tail -n 1 "$journal" | grep -Eq "$entry" && break
	sleep 0.2
done
tail -n 1 "$journal" | grep -Eq "$entry" && (( $(grep -c "" "$journal") > before )) || {
	echo "QuickAdd did not add a new last line to $journal" >&2
	exit 1
}
sleep 2.5
