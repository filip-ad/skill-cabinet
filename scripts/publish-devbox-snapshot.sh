#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPOSITORY_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
REGISTRY_ROOT=${SKILL_CABINET_REGISTRY_ROOT:-"$HOME/dev/agent-skills"}
STATE_DIRECTORY=${SKILL_CABINET_STATE_DIR:-"${XDG_STATE_HOME:-$HOME/.local/state}/skill-cabinet"}
REMOTE=${SKILL_CABINET_REMOTE:-vps-pd}
SOURCE_ID=${SKILL_CABINET_SOURCE_ID:-devbox}

if [[ ! "$SOURCE_ID" =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
  printf 'skill snapshot publish failed: invalid source ID\n' >&2
  exit 1
fi

install -d -m 0700 "$STATE_DIRECTORY"
exec 9>"$STATE_DIRECTORY/publish.lock"
if ! flock -n 9; then
  printf 'skill snapshot publish skipped: another run is active\n'
  exit 0
fi

PUBLISH_DIRECTORY=$(mktemp -d)
SNAPSHOT_FILE="$PUBLISH_DIRECTORY/snapshot.json"
USAGE_DATABASE="$STATE_DIRECTORY/usage.sqlite"
NEXT_DATABASE="$STATE_DIRECTORY/usage.next.sqlite"
REMOTE_SNAPSHOT=
REMOTE_SNAPSHOT_VALIDATED=0

cleanup() {
  local status=$?
  trap - EXIT
  if test "$REMOTE_SNAPSHOT_VALIDATED" = 1; then
    ssh "$REMOTE" sh -s -- "$REMOTE_SNAPSHOT" <<'REMOTE_CLEANUP' || true
test ! -e "$1" || unlink "$1"
REMOTE_CLEANUP
  fi
  for file in "$NEXT_DATABASE" "$NEXT_DATABASE-wal" "$NEXT_DATABASE-shm"; do
    test ! -e "$file" || unlink "$file"
  done
  test ! -e "$SNAPSHOT_FILE" || unlink "$SNAPSHOT_FILE"
  rmdir "$PUBLISH_DIRECTORY" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

verify_known_initial_gap() {
  node --input-type=module - "$HOME" <<'NODE'
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const home = process.argv[2];
const accepted = [
  [".codex/sessions/2026/09/27/rollout-2026-09-27T09-23-44-01a0e1bf-9532-76d3-acbf-d8174337468f.jsonl", 417, 1060, "d50e2d8474134908822ade46e27717d1a22aaa2d4ebd66ee14c988ecafc01461"],
  [".codex/sessions/2026/10/01/rollout-2026-10-01T08-40-47-01a0f631-b236-7472-8158-b790343676c1.jsonl", 6671, 2999, "faef00aa7112892a27ee2474da7474cd5348f9f9a76cc5b51b4a78f2bddf0a9f"],
];
for (const [relative, lineNumber, length, expectedHash] of accepted) {
  const line = fs.readFileSync(path.join(home, relative)).subarray(0).toString("latin1").split("\n")[lineNumber - 1];
  const bytes = Buffer.from(line ?? "", "latin1");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== length || bytes.some((byte) => byte !== 0) || hash !== expectedHash) process.exit(1);
}
NODE
}

import_history() {
  node "$REPOSITORY_ROOT/bin/skill-usage.js" history --db "$1" --registry "$REGISTRY_ROOT"
}

preserve_accepted_gap() {
  node --input-type=module - "$REPOSITORY_ROOT/server/usage.js" "$1" "$2" <<'NODE'
import { pathToFileURL } from "node:url";

const { preserveAcceptedCodexGap } = await import(pathToFileURL(process.argv[2]));
const mode = process.argv[4];
const options = mode === "seed-gap" ? { seed: true } : mode === "seed-clean" ? { seed: false } : {};
if (preserveAcceptedCodexGap(process.argv[3], options) === "missing") process.exit(2);
NODE
}

python3 "$REGISTRY_ROOT/scripts/skill_registry.py" check
for file in "$NEXT_DATABASE" "$NEXT_DATABASE-wal" "$NEXT_DATABASE-shm"; do
  test ! -e "$file" || unlink "$file"
done
if test ! -e "$USAGE_DATABASE"; then
  set +e
  INITIAL_IMPORT=$(import_history "$NEXT_DATABASE" 2>&1)
  INITIAL_STATUS=$?
  set -e
  printf '%s\n' "$INITIAL_IMPORT"
  if test "$INITIAL_STATUS" -eq 0; then
    preserve_accepted_gap "$NEXT_DATABASE" seed-clean
    mv "$NEXT_DATABASE" "$USAGE_DATABASE"
  elif test "$INITIAL_STATUS" -ne 1 \
    || ! grep -Eq '^claude: [0-9]+ added, [0-9]+ duplicates, 0 errors$' <<<"$INITIAL_IMPORT" \
    || ! grep -Eq '^kimi: [0-9]+ added, [0-9]+ duplicates, 0 errors$' <<<"$INITIAL_IMPORT" \
    || ! grep -Eq '^codex: [0-9]+ added, [0-9]+ duplicates, 2 errors$' <<<"$INITIAL_IMPORT" \
    || ! grep -Eq '^antigravity: [0-9]+ added, [0-9]+ duplicates, 0 errors$' <<<"$INITIAL_IMPORT" \
    || ! grep -Fxq 'codex: Malformed JSONL record ~/.codex/sessions/2026/09/27/rollout-2026-09-27T09-23-44-01a0e1bf-9532-76d3-acbf-d8174337468f.jsonl:417' <<<"$INITIAL_IMPORT" \
    || ! grep -Fxq 'codex: Malformed JSONL record ~/.codex/sessions/2026/10/01/rollout-2026-10-01T08-40-47-01a0f631-b236-7472-8158-b790343676c1.jsonl:6671' <<<"$INITIAL_IMPORT" \
    || ! verify_known_initial_gap; then
    printf 'skill snapshot publish failed: initial history gap did not match the accepted records\n' >&2
    exit 1
  else
    import_history "$NEXT_DATABASE"
    preserve_accepted_gap "$NEXT_DATABASE" seed-gap
    mv "$NEXT_DATABASE" "$USAGE_DATABASE"
  fi
else
  cp --reflink=auto --preserve=mode "$USAGE_DATABASE" "$NEXT_DATABASE"
  import_history "$NEXT_DATABASE"
  set +e
  preserve_accepted_gap "$NEXT_DATABASE" preserve
  GAP_STATUS=$?
  set -e
  case "$GAP_STATUS" in
    0) ;;
    2)
      verify_known_initial_gap
      preserve_accepted_gap "$NEXT_DATABASE" seed-gap
      ;;
    *) exit "$GAP_STATUS" ;;
  esac
  mv "$NEXT_DATABASE" "$USAGE_DATABASE"
fi
node "$REPOSITORY_ROOT/bin/skill-snapshot.js" generate \
  --source "$SOURCE_ID" \
  --output "$SNAPSHOT_FILE" \
  --db "$USAGE_DATABASE" \
  --registry "$REGISTRY_ROOT"
node "$REPOSITORY_ROOT/bin/skill-snapshot.js" validate --input "$SNAPSHOT_FILE"

REMOTE_SNAPSHOT=$(ssh "$REMOTE" "mktemp '/tmp/skill-cabinet-$SOURCE_ID.XXXXXX.json'")
if [[ ! "$REMOTE_SNAPSHOT" =~ ^/tmp/skill-cabinet-${SOURCE_ID}\.[A-Za-z0-9]{6}\.json$ ]]; then
  printf 'skill snapshot publish failed: unexpected remote temporary path\n' >&2
  exit 1
fi
REMOTE_SNAPSHOT_VALIDATED=1

scp "$SNAPSHOT_FILE" "$REMOTE:$REMOTE_SNAPSHOT"
ssh "$REMOTE" bash -s -- "$REMOTE_SNAPSHOT" "$SOURCE_ID" <<'REMOTE_INSTALL'
set -euo pipefail
remote_snapshot=$1
source_id=$2
incoming="/var/lib/skill-cabinet/incoming/$source_id.json"
sudo install -m 0600 -o skill-cabinet -g skill-cabinet "$remote_snapshot" "$incoming"
sudo -u skill-cabinet /usr/local/bin/node /srv/skill-cabinet/current/bin/skill-snapshot.js install --input "$incoming" --directory /var/lib/skill-cabinet/snapshots
sudo unlink "$incoming"
unlink "$remote_snapshot"
sudo systemctl restart skill-cabinet.service
for attempt in $(seq 1 20); do
  if curl -fsS -H 'Host: racketdata-files-vps.tail12e6bc.ts.net' http://127.0.0.1:8050/api/health | jq -e '.ok == true and .mode == "read-only"' >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.25
done
exit 1
REMOTE_INSTALL
REMOTE_SNAPSHOT=
REMOTE_SNAPSHOT_VALIDATED=0

printf 'skill snapshot published: %s\n' "$SOURCE_ID"
