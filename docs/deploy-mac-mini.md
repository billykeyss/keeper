# Deploying Keeper to a home Mac mini

Run Keeper as an always-on service on a Mac mini on your home network: the PostGIS database
in Docker, the Keeper server as a macOS `launchd` service that starts at boot and restarts on
crash, reachable from any phone/laptop on your Wi-Fi (and, optionally, from anywhere via
Tailscale).

## 1. Prerequisites (one-time)

On the Mac mini:

1. **Docker Desktop** (or [OrbStack](https://orbstack.dev), lighter) — install, launch once, and
   enable **Settings → General → Start Docker Desktop when you sign in**.
2. **Node.js LTS** — `brew install node` (or the installer from nodejs.org).
3. **Git** — `xcode-select --install` if not already present.
4. macOS **System Settings → Energy → Prevent automatic sleeping when the display is off: ON**
   (a sleeping mini serves nothing). Also enable **Start up automatically after a power failure**.
5. Optional but recommended: **System Settings → Users & Groups → automatic login** for the
   service account, so Docker Desktop (a login-item app) comes up after a reboot without a
   keyboard. (Not needed with OrbStack + `docker context`, or if you never reboot headless.)

## 2. Install Keeper

```bash
git clone https://github.com/billykeyss/keeper.git ~/keeper
cd ~/keeper
npm install
npm --prefix web install
```

## 3. Database: start, migrate, load

Make the database container survive reboots by adding a restart policy override (kept out of
the repo's dev default):

```bash
cat > ~/keeper/docker-compose.override.yml <<'EOF'
services:
  db:
    restart: unless-stopped
EOF
```

Then:

```bash
cd ~/keeper
npm run db:up              # starts PostGIS on localhost:5433 (now with restart: unless-stopped)
npm run db:migrate         # creates all tables/enums
npm run ingest:corridor    # loads the waters + regulations (idempotent; re-run any time)
npm run build:web          # builds the web app into web/dist
```

Sanity check: `npm test` should be all green (uses a separate `fishing_law_test` DB).

## 4. Run Keeper as a launchd service inside a tmux session

At login/boot, launchd runs `scripts/keeper-tmux.sh`, which starts a detached **tmux** session
named `keeper` containing a supervisor loop that runs the server and auto-restarts it if it
crashes. You get boot-start *and* a live console you can attach to anytime.

> Why not `KeepAlive`? tmux daemonizes, so the launchd job exits as soon as the session is up —
> `KeepAlive` would relaunch it in a loop. Instead the plist uses `RunAtLoad` +
> `AbandonProcessGroup` (so launchd doesn't kill the detached tmux server), and crash-restarts
> happen inside the tmux pane.

One-time: `brew install tmux`. Then create the LaunchAgent (port **8791**; change `PORT` if needed):

```bash
mkdir -p ~/Library/LaunchAgents ~/keeper/logs
cat > ~/Library/LaunchAgents/com.keeper.portal.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.keeper.portal</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HOME/keeper/scripts/keeper-tmux.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>8791</string>
    <key>PATH</key><string>$(dirname "$(command -v node)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$HOME/keeper/logs/keeper-launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/keeper/logs/keeper-launchd.err.log</string>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.keeper.portal.plist
```

Verify:

```bash
tmux ls                                                           # → keeper: 1 windows ...
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8791/   # → 200
tmux attach -t keeper                                             # live server logs; detach: Ctrl-b then d
```

Day-to-day management (the tmux session, not launchd, is the thing that runs):

```bash
tmux attach -t keeper              # watch logs / interact (detach with Ctrl-b d — do NOT Ctrl-C unless stopping)
tmux kill-session -t keeper        # stop the server + supervisor
~/keeper/scripts/keeper-tmux.sh    # start it again by hand (idempotent — no-op if already running)
launchctl kickstart gui/$(id -u)/com.keeper.portal   # same as running the script, via launchd
```

The supervisor restarts the server ~3s after any crash. Killing the `node`/`tsx` process does
NOT stop Keeper (that's the supervisor doing its job) — use `tmux kill-session -t keeper`.

## 5. Reach it from your phone

- **On your home Wi-Fi:** macOS advertises the mini over Bonjour, so
  **`http://<mini-hostname>.local:8791`** works from iPhones/Macs (find/set the hostname in
  System Settings → General → Sharing → Local hostname — e.g. `keeper-mini.local`). Android
  sometimes lacks mDNS; use the raw IP instead (`ipconfig getifaddr en0` on the mini), and give
  the mini a **DHCP reservation** in your router so the IP never changes.
- **Away from home (recommended): [Tailscale](https://tailscale.com)** — install on the mini and
  your phone, sign in to the same tailnet, then `http://<mini-tailscale-name>:8791` works from
  anywhere, encrypted, with zero router changes.
- **Do NOT port-forward** the raw port on your router — the app has no authentication; exposing
  it to the open internet also exposes your regulations DB API to the world.

Add to Home Screen (iOS Safari: Share → Add to Home Screen) for an app-like launcher.

## 6. Updating to a new version

```bash
cd ~/keeper
git pull
npm install && npm --prefix web install     # in case deps changed
npm run db:migrate                          # applies any new migrations (no-op otherwise)
npm run ingest:corridor                     # reloads regulations if data/ changed (idempotent)
npm run build:web                           # rebuild the web app
tmux kill-session -t keeper && ./scripts/keeper-tmux.sh   # restart the server session
```

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `tmux ls` shows no `keeper` session after boot | Run `~/keeper/scripts/keeper-tmux.sh` by hand and read its output; check `~/keeper/logs/keeper-launchd.err.log` (usually a PATH problem — tmux/node not found by launchd). |
| `EADDRINUSE` repeating in the tmux pane | Another process owns the port — change `PORT` in the plist AND restart: `tmux kill-session -t keeper && launchctl kickstart gui/$(id -u)/com.keeper.portal`. |
| Server keeps restarting every 3s | Attach (`tmux attach -t keeper`) and read the crash output — most often the DB is down (below). |
| API 500s / "connection refused" to Postgres | Docker isn't running or the container is down: open Docker Desktop, then `cd ~/keeper && npm run db:up`. The `restart: unless-stopped` override (step 3) prevents this after reboots once Docker itself is running. |
| Map loads but no pins | DB is empty — run `npm run ingest:corridor`. |
| Blank page at `/` | `web/dist` missing — run `npm run build:web`. |
| Works on the mini, not on the phone | Same Wi-Fi? macOS firewall prompt denied? (System Settings → Network → Firewall → allow node/incoming). Android + `.local` name? Use the IP. |
| After macOS reboot nothing runs | Docker Desktop must be a login item and the user session must log in (see §1.5); LaunchAgents run at login, not before. |

## Notes

- The server serves both the API and the built web app from one process/port — nothing else to run.
- Postgres data lives in the Docker volume; `docker compose down` keeps it, `docker compose down -v` wipes it (re-run migrate + ingest after a wipe).
- The regulations carry an as-of date and a "verify current conditions" advisory — re-run the
  ingest after updating `data/corridor/*.json` when regulations change.
