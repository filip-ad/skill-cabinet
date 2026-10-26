import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publisher = path.join(root, "scripts", "publish-devbox-snapshot.sh");

function executable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "skill-publish-"));
  const bin = path.join(temporary, "bin");
  const state = path.join(temporary, "state");
  const registry = path.join(temporary, "registry");
  const log = path.join(temporary, "commands.log");
  fs.mkdirSync(bin);
  fs.mkdirSync(registry);

  executable(path.join(bin, "python3"), `#!/bin/sh
printf 'python3 %s\\n' "$*" >> "$PUBLISH_TEST_LOG"
exit 0
`);
  executable(path.join(bin, "node"), `#!/bin/sh
printf 'node %s\\n' "$*" >> "$PUBLISH_TEST_LOG"
if test "$1" = --input-type=module; then
  cat >/dev/null
  if test "$#" = 3; then
    test "\${PUBLISH_TEST_GAP_VERIFY_FAIL:-0}" != 1
    exit $?
  fi
  db=$4
  mode=$5
  case "$mode" in
    seed-gap) printf '\naccepted-gap=2\ncodex-errors=2\n' >> "$db" ;;
    seed-clean) printf '\naccepted-gap=0\n' >> "$db" ;;
    preserve)
      if grep -q '^accepted-gap=2$' "$db"; then
        printf 'codex-errors=2\n' >> "$db"
      elif ! grep -q '^accepted-gap=0$' "$db"; then
        exit 2
      fi
      ;;
  esac
  exit 0
fi
mode=
db=
output=
for value in "$@"; do
  case "$value" in
    *skill-usage.js) mode=history ;;
    *skill-snapshot.js) test -n "$mode" || mode=snapshot ;;
  esac
done
while test "$#" -gt 0; do
  case "$1" in
    --db) shift; db=$1 ;;
    --output) shift; output=$1 ;;
    generate) mode=generate ;;
    validate) mode=validate ;;
  esac
  shift
done
if test "$mode" = history; then
  test "\${PUBLISH_TEST_HISTORY_FAIL:-0}" != 1 || exit 1
  if test "\${PUBLISH_TEST_SKIP_INITIAL_GAP:-0}" != 1 && test ! -e "$PUBLISH_TEST_LOG.bootstrap"; then
    printf '%s\\n' \
      'claude: 4 added, 0 duplicates, 0 errors' \
      'kimi: 3 added, 0 duplicates, 0 errors' \
      'codex: 5 added, 0 duplicates, 2 errors' \
      'antigravity: 0 added, 0 duplicates, 0 errors' \
      'codex: Malformed JSONL record ~/.codex/sessions/2026/09/27/rollout-2026-09-27T09-23-44-01a0e1bf-9532-76d3-acbf-d8174337468f.jsonl:417' \
      'codex: Malformed JSONL record ~/.codex/sessions/2026/10/01/rollout-2026-10-01T08-40-47-01a0f631-b236-7472-8158-b790343676c1.jsonl:6671' \
      'identity: 12 observations checked'
    : > "$PUBLISH_TEST_LOG.bootstrap"
    : > "$db"
    exit 1
  fi
  printf '%s\\n' \
    'claude: 0 added, 0 duplicates, 0 errors' \
    'kimi: 0 added, 0 duplicates, 0 errors' \
    'codex: 0 added, 0 duplicates, 0 errors' \
    'antigravity: 0 added, 0 duplicates, 0 errors' \
    'identity: 12 observations checked'
  : > "$db"
fi
if test "$mode" = generate; then
  printf '{}\\n' > "$output"
fi
exit 0
`);
  executable(path.join(bin, "ssh"), `#!/bin/sh
printf 'ssh %s\\n' "$*" >> "$PUBLISH_TEST_LOG"
case "$*" in
  *skill-cabinet-devbox.*) printf '%s\\n' "\${PUBLISH_TEST_REMOTE_TEMP:-/tmp/skill-cabinet-devbox.ABC123.json}" ;;
esac
case "$*" in
  *'bash -s --'*) cat >> "$PUBLISH_TEST_LOG" ;;
  *'sh -s --'*) cat >/dev/null ;;
esac
exit 0
`);
  executable(path.join(bin, "scp"), `#!/bin/sh
printf 'scp %s\\n' "$*" >> "$PUBLISH_TEST_LOG"
exit 0
`);

  return { temporary, bin, state, registry, log };
}

function runPublisher(value, extraEnvironment = {}) {
  return spawnSync("bash", [publisher], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${value.bin}:${process.env.PATH}`,
      PUBLISH_TEST_LOG: value.log,
      SKILL_CABINET_STATE_DIR: value.state,
      SKILL_CABINET_REGISTRY_ROOT: value.registry,
      ...extraEnvironment,
    },
  });
}

test("daily timer uses the small persistent user-service design", () => {
  const service = fs.readFileSync(path.join(root, "deploy", "skill-cabinet-publish.service"), "utf8");
  const timer = fs.readFileSync(path.join(root, "deploy", "skill-cabinet-publish.timer"), "utf8");
  const script = fs.readFileSync(publisher, "utf8");

  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^WorkingDirectory=%h\/dev\/skill-cabinet$/m);
  assert.match(service, /^Environment=NODE_VERSION=22$/m);
  assert.match(service, /^ExecStart=%h\/\.nvm\/nvm-exec %h\/dev\/skill-cabinet\/scripts\/publish-devbox-snapshot\.sh$/m);
  assert.match(timer, /^OnCalendar=\*-\*-\* 03:15:00$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(script, /flock -n 9/);
  assert.match(script, /skill_registry\.py" check/);
  assert.match(script, /usage\.sqlite/);
  assert.match(script, /preserveAcceptedCodexGap/);
  assert.match(script, /skill-snapshot\.js" validate/);
  assert.match(script, /systemctl restart skill-cabinet\.service/);
  assert.doesNotMatch(script, /curl[^\n]+https:\/\//);
});

test("publisher validates and installs one filtered snapshot", () => {
  const value = fixture();
  try {
    const result = runPublisher(value);
    assert.equal(result.status, 0, result.stderr);
    const commands = fs.readFileSync(value.log, "utf8");
    assert.match(commands, /python3 .*skill_registry\.py check/);
    assert.match(commands, /node .*skill-usage\.js history/);
    assert.match(commands, /node --input-type=module -/);
    assert.match(commands, /node .*skill-snapshot\.js generate/);
    assert.match(commands, /node .*skill-snapshot\.js validate/);
    assert.match(commands, /scp .*snapshot\.json vps-pd:\/tmp\/skill-cabinet-devbox\.ABC123\.json/);
    assert.match(commands, /ssh vps-pd [\s\S]*skill-snapshot\.js install/);
    assert.match(commands, /ssh vps-pd [\s\S]*systemctl restart skill-cabinet\.service/);
    assert.ok(fs.existsSync(path.join(value.state, "usage.sqlite")));
    assert.match(fs.readFileSync(path.join(value.state, "usage.sqlite"), "utf8"), /accepted-gap=2/);
    assert.equal(fs.statSync(value.state).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test("a new provider import error stops publication", () => {
  const value = fixture();
  try {
    const result = runPublisher(value, { PUBLISH_TEST_HISTORY_FAIL: "1" });
    assert.notEqual(result.status, 0);
    const commands = fs.readFileSync(value.log, "utf8");
    assert.match(commands, /skill-usage\.js history/);
    assert.doesNotMatch(commands, /^scp /m);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test("a first import that does not match the exact accepted gap is discarded", () => {
  const value = fixture();
  try {
    const result = runPublisher(value, { PUBLISH_TEST_GAP_VERIFY_FAIL: "1" });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(value.state, "usage.sqlite")), false);
    assert.equal(fs.existsSync(path.join(value.state, "usage.next.sqlite")), false);
    const commands = fs.readFileSync(value.log, "utf8");
    assert.doesNotMatch(commands, /^scp /m);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test("a failed later import does not change the live usage database", () => {
  const value = fixture();
  try {
    fs.mkdirSync(value.state);
    const database = path.join(value.state, "usage.sqlite");
    fs.writeFileSync(database, "stable database");
    const result = runPublisher(value, { PUBLISH_TEST_HISTORY_FAIL: "1" });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(database, "utf8"), "stable database");
    assert.equal(fs.existsSync(path.join(value.state, "usage.next.sqlite")), false);
    const commands = fs.readFileSync(value.log, "utf8");
    assert.doesNotMatch(commands, /^scp /m);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test("a later clean import migrates and preserves the accepted gap", () => {
  const value = fixture();
  try {
    fs.mkdirSync(value.state);
    const database = path.join(value.state, "usage.sqlite");
    fs.writeFileSync(database, "existing database\n");
    const result = runPublisher(value, { PUBLISH_TEST_SKIP_INITIAL_GAP: "1" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(database, "utf8"), /accepted-gap=2/);
    assert.match(fs.readFileSync(database, "utf8"), /codex-errors=2/);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test("an unexpected remote path is rejected before transfer or cleanup", () => {
  const value = fixture();
  try {
    const result = runPublisher(value, { PUBLISH_TEST_REMOTE_TEMP: "unsafe remote output" });
    assert.notEqual(result.status, 0);
    const commands = fs.readFileSync(value.log, "utf8");
    assert.equal(commands.match(/^ssh /gm)?.length, 1);
    assert.doesNotMatch(commands, /^scp /m);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});

test("a remote path with shell syntax is rejected", () => {
  const value = fixture();
  try {
    const result = runPublisher(value, {
      PUBLISH_TEST_REMOTE_TEMP: "/tmp/skill-cabinet-devbox.ABC123';touch injected;'.json",
    });
    assert.notEqual(result.status, 0);
    const commands = fs.readFileSync(value.log, "utf8");
    assert.equal(commands.match(/^ssh /gm)?.length, 1);
    assert.doesNotMatch(commands, /^scp /m);
  } finally {
    fs.rmSync(value.temporary, { recursive: true, force: true });
  }
});
