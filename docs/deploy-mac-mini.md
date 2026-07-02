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

## 4. Run Keeper as a launchd service

Pick a port (below: **8791**; use anything free). Create the LaunchAgent:

```bash
mkdir -p ~/Library/LaunchAgents ~/keeper/logs
cat > ~/Library/LaunchAgents/com.keeper.portal.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.keeper.portal</string>
  <key>WorkingDirectory</key><string>$HOME/keeper</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v npx)</string>
    <string>tsx</string>
    <string>src/api/server.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>8791</string>
    <key>PATH</key><string>$(dirname "$(command -v node)"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/keeper/logs/keeper.log</string>
  <key>StandardErrorPath</key><string>$HOME/keeper/logs/keeper.err.log</string>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.keeper.portal.plist
```

`KeepAlive` restarts the server if it crashes; `RunAtLoad` starts it at login/boot.

Verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8791/          # → 200
curl -s "http://localhost:8791/api/waters?bbox=-120.6,38.8,-119.2,40.2" | head -c 200
tail -f ~/keeper/logs/keeper.log                                          # "Keeper API listening..."
```

Service management:

```bash
launchctl unload ~/Library/LaunchAgents/com.keeper.portal.plist   # stop
launchctl load   ~/Library/LaunchAgents/com.keeper.portal.plist   # start
launchctl kickstart -k gui/$(id -u)/com.keeper.portal             # restart
```

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
launchctl kickstart -k gui/$(id -u)/com.keeper.portal
```

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` in `keeper.err.log` | Another process owns the port — change `PORT` in the plist, `launchctl unload` + `load`. |
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
