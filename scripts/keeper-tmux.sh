#!/usr/bin/env bash
# Start (or reuse) a detached tmux session running the Keeper server.
#
# Designed to be launched by launchd at login (see docs/deploy-mac-mini.md §4):
# tmux daemonizes and this script exits immediately, so the launchd job must use
# RunAtLoad + AbandonProcessGroup — NOT KeepAlive. Crash-restarts are handled by
# this script's --serve loop running inside the tmux pane (the loop process is
# named keeper-tmux.sh, so killing the node server never kills the supervisor).
#
#   Attach to watch logs:  tmux attach -t keeper   (detach: Ctrl-b then d)
#   Stop the server:       tmux kill-session -t keeper
#
# Env: PORT (default 8791), KEEPER_TMUX_SESSION (default "keeper").
set -euo pipefail

SESSION="${KEEPER_TMUX_SESSION:-keeper}"
PORT="${PORT:-8791}"
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# launchd provides a minimal PATH; make sure Homebrew tmux/node are findable.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ "${1:-}" == "--serve" ]]; then
  # Supervisor loop, running inside the tmux pane.
  cd "$DIR"
  while true; do
    PORT="$PORT" npx tsx src/api/server.ts && rc=0 || rc=$?
    echo "[keeper] server exited (code $rc) — restarting in 3s (Ctrl-C twice to stop)"
    sleep 3
  done
fi

if ! command -v tmux >/dev/null; then
  echo "keeper-tmux: tmux not found (brew install tmux)" >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "keeper-tmux: session '$SESSION' already running (tmux attach -t $SESSION)"
  exit 0
fi

tmux new-session -d -s "$SESSION" -c "$DIR" \
  "PORT=$PORT KEEPER_TMUX_SESSION=$SESSION '$SCRIPT' --serve"

echo "keeper-tmux: started session '$SESSION' serving on port $PORT (tmux attach -t $SESSION)"
