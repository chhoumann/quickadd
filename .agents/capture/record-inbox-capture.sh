#!/usr/bin/env bash
# Drive QuickAdd's "Add to inbox" Capture choice (fixture: demo-data.json) the way
# a user would. Run it under the shared recorder so failures discard the take:
#
#   obsidian-e2e capture record inbox.webm --cursor -- .agents/capture/record-inbox-capture.sh
#
# Needs a capture instance (obsidian-e2e capture launch) on $OBSIDIAN_E2E_CDP_PORT
# with the fixture vault; see .agents/capture/README.md.
set -euo pipefail

: "${OBSIDIAN_E2E_CDP_PORT:?run under obsidian-e2e capture record}"
: "${OBSIDIAN_E2E_CAPTURE_VAULT_PATH:?export the capture launch --print-env output}"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-quickadd-capture}"
ab() { agent-browser --cdp "$OBSIDIAN_E2E_CDP_PORT" "$@" >/dev/null; }
cap() { obsidian-e2e capture "$@"; }
text="Call the plumber about the kitchen tap"
inbox="$OBSIDIAN_E2E_CAPTURE_VAULT_PATH/Inbox.md"
count() { local n; n=$(grep -cxF -- "- $text" "$inbox" 2>/dev/null); echo "${n:-0}"; }
before=$(count)

ab eval 'app.workspace.openLinkText("Inbox", "", false).then(() => app.workspace.activeEditor?.editor?.blur?.())'
ab mouse move 1180 740
sleep 1
ab press Control+p
sleep 0.5
cap type "QuickAdd: Run" --delay 60 --selector ".prompt-input"
sleep 0.5
ab press Enter
sleep 0.9
cap type "inbox" --delay 80 --selector ".prompt-input"
sleep 0.5
ab press Enter
sleep 0.8
cap type "$text" --delay 45
sleep 0.6
ab press Enter

# Verify the product behaviour, not just the pixels: this take must add a NEW
# entry (a reused vault may already contain one from an earlier take).
for _ in $(seq 1 30); do
	(( $(count) > before )) && break
	sleep 0.2
done
(( $(count) > before )) || { echo "QuickAdd did not add a new entry to Inbox.md" >&2; exit 1; }
sleep 2
