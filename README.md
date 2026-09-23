# Skill Cabinet

Skill Cabinet is a read-only private dashboard for Filip's governed agent skills.
It shows each installation, its command-line tool, scope, owner, governance,
currency, and observed use. It can read registered skill files. It cannot
install, update, retire, move, quarantine, or remove a skill.

In local mode, the dashboard reads `INVENTORY.json` and `SKILL_CURRENCY.json`
from the `agent-skills` repository. In central mode, it combines validated,
privacy-limited source snapshots. It does not scan for a second catalog. It
does not contact upstream sources.

## Run

Use Node 22.13 or newer.

```bash
npm install
npm run build
SKILL_CABINET_NO_OPEN=1 npm start
```

The server binds to `127.0.0.1:3781`. Set `PORT` to use another local port.
Set `SKILL_REGISTRY_ROOT` if the registry is not at `~/dev/agent-skills`.

Set `SKILL_CABINET_SNAPSHOT_DIR` to run the central snapshot service. Set
`SKILL_CABINET_ALLOWED_HOSTS` to a comma-separated list of exact proxy host
names. Localhost stays allowed.

The usage index is rebuildable local cache data at
`~/.local/share/skill-cabinet/usage.sqlite`. The exact recorder writes
privacy-limited events to `~/.local/share/skill-cabinet/usage.jsonl`. The
default cache directory is owner-only. The database and its recovery files are
also owner-only.

```bash
skill-usage --cli codex --path ~/.agents/skills/example/SKILL.md \
  --session local-session-id --repo "$PWD"
skill-usage history --registry ~/dev/agent-skills
```

The recorder stores a hash of the session ID. It does not store prompts,
responses, reasoning, tool arguments, environment data, credentials, or raw
commands. A recorder failure must not block the task that called it. The v1
dashboard does not import recorder logs. They stay local for a later design
that can reconcile them with provider history without double-counting calls.

The history command imports exact Claude and Kimi skill calls. It imports only
clear, first-person Codex skill announcements and marks them as inferred.
Antigravity history is not counted. Per-file cursors make later imports
incremental. Codex imports retain the session repository from the same history
file across those cursor reads. Provider history is the only source for v1
dashboard totals. The command keeps unclear identities out of installation
counts.

## Develop and prove

```bash
npm run dev
npm test
npm run build
```

See [FORK.md](FORK.md) for the upstream base and update rules.
See [docs/snapshot-contract.md](docs/snapshot-contract.md) for the source input
format. See [docs/deploy-vps.md](docs/deploy-vps.md) for the manual VPS runbook.

## License

[MIT](LICENSE). The upstream license is preserved.
