# VPS deployment

This runbook deploys Skill Cabinet to the HostUp VPS. The service listens on
`127.0.0.1:8050`. Tailscale Serve exposes it only on
`https://racketdata-files-vps.tail12e6bc.ts.net:8445/`.

The VPS workflow marks deployment as manual. Run these commands only after the
exact release commit has passed proof, Auto Review, integration, push, and the
operator UI approval gate.

## Preflight

On the VPS, confirm that the selected ports and service name are free:

```bash
ss -lnt | grep -E ':(8050|8445)\b' && exit 1 || true
systemctl status skill-cabinet.service --no-pager || true
tailscale status
tailscale serve status --json
node --version
df -h / /srv
free -h
```

Node must be version 22.13 or newer. Save the current Tailscale Serve state before
the change:

```bash
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin \
  skill-cabinet 2>/dev/null || true
sudo install -d -m 0750 -o root -g skill-cabinet /var/lib/skill-cabinet
sudo tailscale serve get-config /var/lib/skill-cabinet/tailscale-serve-before.json --all
```

## Install the release

Set `RELEASE_SHA` to the full integrated commit ID. Do not use a branch name.

```bash
RELEASE_SHA=<full-commit-id>
sudo install -d -m 0755 -o root -g root \
  /srv/skill-cabinet /srv/skill-cabinet/releases
sudo install -d -m 0700 -o skill-cabinet -g skill-cabinet \
  /var/lib/skill-cabinet/incoming /var/lib/skill-cabinet/snapshots
sudo git clone https://github.com/filip-ad/skill-cabinet.git \
  "/srv/skill-cabinet/releases/$RELEASE_SHA"
sudo git -C "/srv/skill-cabinet/releases/$RELEASE_SHA" checkout --detach "$RELEASE_SHA"
test "$(sudo git -C "/srv/skill-cabinet/releases/$RELEASE_SHA" rev-parse HEAD)" = "$RELEASE_SHA"
sudo npm --prefix "/srv/skill-cabinet/releases/$RELEASE_SHA" ci --ignore-scripts
sudo npm --prefix "/srv/skill-cabinet/releases/$RELEASE_SHA" run build
sudo npm --prefix "/srv/skill-cabinet/releases/$RELEASE_SHA" prune --omit=dev --ignore-scripts
sudo ln -sfn "/srv/skill-cabinet/releases/$RELEASE_SHA" /srv/skill-cabinet/current
sudo install -m 0644 "/srv/skill-cabinet/current/deploy/skill-cabinet.service" \
  /etc/systemd/system/skill-cabinet.service
```

## Publish the devbox snapshot

Run this part on the devbox from the integrated product checkout:

```bash
set -euo pipefail
SKILL_CABINET_USAGE_TMP=$(mktemp -d)
node bin/skill-usage.js history \
  --db "$SKILL_CABINET_USAGE_TMP/usage.sqlite" \
  --registry /home/filip/dev/agent-skills
node bin/skill-snapshot.js generate \
  --source devbox \
  --output /tmp/skill-cabinet-devbox.json \
  --db "$SKILL_CABINET_USAGE_TMP/usage.sqlite" \
  --registry /home/filip/dev/agent-skills
node bin/skill-snapshot.js validate --input /tmp/skill-cabinet-devbox.json
scp /tmp/skill-cabinet-devbox.json vps-pd:/tmp/skill-cabinet-devbox.json
ssh vps-pd 'sudo install -m 0600 -o skill-cabinet -g skill-cabinet \
  /tmp/skill-cabinet-devbox.json /var/lib/skill-cabinet/incoming/devbox.json && \
  sudo -u skill-cabinet /usr/local/bin/node \
  /srv/skill-cabinet/current/bin/skill-snapshot.js install \
  --input /var/lib/skill-cabinet/incoming/devbox.json \
  --directory /var/lib/skill-cabinet/snapshots && \
  sudo rm /var/lib/skill-cabinet/incoming/devbox.json \
  /tmp/skill-cabinet-devbox.json'
rm /tmp/skill-cabinet-devbox.json
rm "$SKILL_CABINET_USAGE_TMP/usage.sqlite"
rmdir "$SKILL_CABINET_USAGE_TMP"
```

Use the same commands for another machine. Change only the stable source ID and
file name. After the service is live, restart it after each valid publish so it
loads the new snapshot. Then check its health:

```bash
ssh vps-pd 'sudo systemctl restart skill-cabinet.service && \
  systemctl is-active --quiet skill-cabinet.service && \
  curl -fsS -H "Host: racketdata-files-vps.tail12e6bc.ts.net" \
  http://127.0.0.1:8050/api/health | jq -e ".ok == true"'
```

## Start and expose the service

Run this part on the VPS:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now skill-cabinet.service
curl -fsS -H 'Host: racketdata-files-vps.tail12e6bc.ts.net' \
  http://127.0.0.1:8050/api/health | jq -e \
  '.ok == true and .mode == "read-only" and (.snapshot_sources | length) >= 1'
sudo tailscale serve --bg --https=8445 http://127.0.0.1:8050
tailscale serve status --json
```

From a Tailnet client, open the private URL and check the catalog, a skill
preview, the source filter, and usage totals. Then prove restart:

```bash
sudo systemctl restart skill-cabinet.service
systemctl is-active --quiet skill-cabinet.service
curl -fsS -H 'Host: racketdata-files-vps.tail12e6bc.ts.net' \
  http://127.0.0.1:8050/api/health | jq -e '.ok == true'
```

Confirm that port 8050 listens only on loopback. Confirm that the public Caddy
configuration has no Skill Cabinet route.

## Rollback

Restore the prior Tailscale Serve state and stop the new service:

```bash
sudo tailscale serve set-config \
  /var/lib/skill-cabinet/tailscale-serve-before.json --all
sudo systemctl disable --now skill-cabinet.service
```

If this release replaced an older release, repoint `/srv/skill-cabinet/current`
to its exact prior release directory. Reinstall its service unit. Then run
`systemctl daemon-reload` and restart the service. The last valid source
snapshot also remains at `/var/lib/skill-cabinet/snapshots/devbox.previous`.
