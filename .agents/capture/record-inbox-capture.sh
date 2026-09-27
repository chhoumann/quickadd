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

ab eval 'app.workspace.openLinkText("Inbox", "", false).then(() => app.workspace.activeEditor?.editor?.blur?.())'
ab mouse move 1180 740
sleep 1
ab press Control+p
sleep 0.5
cap type "QuickAdd: Run" --delay 60
sleep 0.5
ab press Enter
sleep 0.9
cap type "inbox" --delay 80
sleep 0.5
ab press Enter
sleep 0.8
cap type "$text" --delay 45
sleep 0.6
ab press Enter

# Verify the product behaviour, not just the pixels.
for _ in $(seq 1 30); do
	grep -qF -- "- $text" "$OBSIDIAN_E2E_CAPTURE_VAULT_PATH/Inbox.md" && break
	sleep 0.2
done
grep -qF -- "- $text" "$OBSIDIAN_E2E_CAPTURE_VAULT_PATH/Inbox.md"
sleep 2
