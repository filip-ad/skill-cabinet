# Snapshot contract

Schema version 1 lets an operator publish one filtered source view to the
central dashboard. Use a stable source ID such as `devbox` or `lenovo`. Do not
derive it from a hostname because a hostname can change.

## Boundary

The producer reads the governed registry exports, the local aggregate usage
index, and each registered `SKILL.md`. It publishes:

- the schema version, source ID, and generation time;
- governed installation, group, and currency fields;
- aggregate use counts and adapter health counts;
- one `SKILL.md` text value for each installation.

It does not publish raw events, session hashes, prompts, responses, reasoning,
tool arguments, commands, environment data, credentials, or other skill files.
The validator rejects unknown fields before install. It also requires exactly
one `SKILL.md` manuscript for each installation and verifies its SHA-256 digest
against the governed installation record.

The v1 aggregate usage index contains provider-history observations only. The
separate recorder log stays on the source machine and is not imported into the
index or a snapshot. This avoids counting one invocation once from provider
history and again from the recorder without a reliable shared event identity.

## Commands

Create and validate a snapshot:

```bash
node bin/skill-usage.js history \
  --registry /home/filip/dev/agent-skills
node bin/skill-snapshot.js generate \
  --source devbox \
  --output /tmp/skill-cabinet-devbox.json \
  --registry /home/filip/dev/agent-skills
node bin/skill-snapshot.js validate \
  --input /tmp/skill-cabinet-devbox.json
```

Install it into a server snapshot directory:

```bash
node bin/skill-snapshot.js install \
  --input /tmp/skill-cabinet-devbox.json \
  --directory /var/lib/skill-cabinet/snapshots
```

Install validates the complete input. It writes the new source file with an
atomic rename. If a current source file exists, it copies that file to
`<source-id>.previous` first.

## Merge rules

The server prefixes each installation ID with its source ID. The same local ID
on two machines cannot merge. Stable canonical group IDs merge across sources,
so one skill does not become two unique skills only because it exists on two
machines. Counts add across sources. Unique session counts add across source
namespaces. The newest last-use value wins.

If one skill ID has different content digests on different sources, health data
reports a source conflict. The server does not choose one version. A source is
stale when its snapshot is more than seven days old.
Each installation keeps the currency check time from its source snapshot. The
global summary shows the newest currency check time across all sources.

The first release uses manual file transfer. A later automatic publisher needs
its own approval, authentication design, failure report, and schedule.
