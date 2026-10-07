import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readCatalogFile } from "./catalog.js";
import {
  createSnapshot,
  installSnapshot,
  loadSnapshotDirectory,
  validateSnapshot,
  writeSnapshotAtomic,
} from "./snapshot.js";
import { UsageStore } from "./usage.js";


function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fixture({
  sourceId = "devbox",
  content = "# Sample\n",
  digest = sha256(content),
  generatedAt = "2026-09-07T12:00:00Z",
  currencyCheckedAt = "2026-09-07T11:00:00Z",
  withUsage = true,
  withRecorder = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-snapshot-"));
  const skillRoot = path.join(root, "sample");
  fs.mkdirSync(skillRoot);
  fs.writeFileSync(path.join(skillRoot, "SKILL.md"), content);
  const installation = {
    installation_id: "install-1",
    canonical_group_id: "group-1",
    skill_id: "sample",
    display_name: "Sample",
    description: "Sample skill",
    location: path.join(skillRoot, "SKILL.md"),
    real_location: path.join(skillRoot, "SKILL.md"),
    content_sha256: digest,
    scope: "global",
    cli: "shared",
    repository: "",
    ownership: "local",
    governance: "managed",
    governance_owner: "filip-ad/agent-skills",
    tracking_issue: "",
    source: "agent-skills",
    currency: {
      name: "sample",
      target: path.join(skillRoot, "SKILL.md"),
      ownership: "local",
      mechanism: "agent-skills",
      upstream: "agent-skills canonical repository",
      status: "current",
      installed: digest,
      latest: digest,
      action: "none",
    },
  };
  const groups = [{
    canonical_group_id: "group-1",
    skill_id: "sample",
    display_name: "Sample",
    description: "Sample skill",
    installation_ids: ["install-1"],
  }];
  const inventory = {
    schema_version: 1,
    counts: { installations: 1, canonical_groups: 1 },
    installations: [installation],
    canonical_groups: groups,
  };
  const catalog = {
    inventory,
    currency: { checked_at: currencyCheckedAt },
    installations: [installation],
  };
  const usageStore = new UsageStore({ dbPath: path.join(root, "usage.sqlite"), inventory });
  if (withUsage) {
    usageStore.importEvents([{
      source_id: "event-1",
      occurred_at: "2026-09-07T10:00:00Z",
      cli: "codex",
      session_id: "private-session",
      skill_path: installation.location,
      occurrence_evidence: "exact",
    }], "codex");
  }
  if (withRecorder) {
    usageStore.importEvents([{
      source_id: "recorder-event",
      occurred_at: "2026-09-07T10:00:00Z",
      cli: "codex",
      session_id: "private-session",
      skill_path: installation.location,
      occurrence_evidence: "exact",
    }], "recorder");
  }
  const snapshot = createSnapshot({ sourceId, catalog, usageStore, generatedAt });
  usageStore.close();
  return { root, snapshot };
}

test("creates an allowlisted snapshot without raw events or session hashes", () => {
  const value = fixture();
  assert.equal(value.snapshot.source_id, "devbox");
  assert.equal(value.snapshot.usage.summary.invocations, 1);
  assert.equal(value.snapshot.manuscripts[0].content, "# Sample\n");
  const serialized = JSON.stringify(value.snapshot);
  assert.equal(serialized.includes("private-session"), false);
  assert.equal(serialized.includes("session_hash"), false);
  assert.equal(serialized.includes('"events"'), false);
  fs.rmSync(value.root, { recursive: true });
});

test("creates a valid zero-usage snapshot", () => {
  const value = fixture({ withUsage: false });
  assert.deepEqual(value.snapshot.usage.summary, {
    invocations: 0,
    unique_sessions: 0,
    last_use: null,
    unassigned_exact: 0,
  });
  fs.rmSync(value.root, { recursive: true });
});

test("snapshot excludes recorder rows from an existing mixed usage database", () => {
  const value = fixture({ withRecorder: true });
  assert.equal(value.snapshot.usage.summary.invocations, 1);
  assert.equal(value.snapshot.usage.by_cli[0].invocations, 1);
  assert.equal(value.snapshot.usage.installation_usage[0].invocations, 1);
  fs.rmSync(value.root, { recursive: true });
});

test("snapshot generation excludes the separate recorder evidence stream", () => {
  const value = fixture({ withUsage: false });
  const registry = path.join(value.root, "registry");
  const output = path.join(value.root, "snapshot.json");
  const recorder = path.join(value.root, "usage.jsonl");
  fs.mkdirSync(registry);
  fs.writeFileSync(path.join(registry, "INVENTORY.json"), JSON.stringify({
    schema_version: 1,
    counts: value.snapshot.catalog.counts,
    canonical_groups: value.snapshot.catalog.canonical_groups,
    installations: value.snapshot.catalog.installations,
  }));
  fs.writeFileSync(path.join(registry, "SKILL_CURRENCY.json"), JSON.stringify({
    schema_version: 1,
    checked_at: value.snapshot.catalog.currency_checked_at,
    targets: [],
  }));
  fs.writeFileSync(recorder, `${JSON.stringify({
    source_id: "recorder-event",
    occurred_at: "2026-09-07T10:00:00Z",
    cli: "codex",
    session_hash: "private-hash",
    skill_path: value.snapshot.catalog.installations[0].location,
    repository: null,
    adapter: "recorder",
    parser_version: "recorder-1",
    occurrence_evidence: "exact",
  })}\n`);

  const result = spawnSync(process.execPath, [
    path.resolve("bin/skill-snapshot.js"),
    "generate",
    "--source", "devbox",
    "--output", output,
    "--registry", registry,
    "--db", path.join(value.root, "fresh-usage.sqlite"),
  ], {
    encoding: "utf8",
    env: { ...process.env, SKILL_USAGE_LOG: recorder },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output)).usage.summary.invocations, 0);
  fs.rmSync(value.root, { recursive: true });
});

test("rejects unsupported versions, private fields, and invalid source IDs", () => {
  const value = fixture();
  assert.throws(() => validateSnapshot({ ...value.snapshot, schema_version: 2 }), /unsupported schema/);
  assert.throws(() => validateSnapshot({ ...value.snapshot, source_id: "Lenovo Work" }), /source ID/);
  assert.throws(() => validateSnapshot({ ...value.snapshot, prompt: "private" }), /forbidden field: prompt/);
  assert.throws(() => validateSnapshot({
    ...value.snapshot,
    usage: { ...value.snapshot.usage, summary: { ...value.snapshot.usage.summary, raw_command: "private" } },
  }), /forbidden field: raw_command/);
  const nested = structuredClone(value.snapshot);
  nested.catalog.installations[0].currency.latest = { credential: "private" };
  assert.throws(() => validateSnapshot(nested), /must be a scalar value/);
  const incomplete = structuredClone(value.snapshot);
  delete incomplete.catalog.installations[0].display_name;
  assert.throws(() => validateSnapshot(incomplete), /display_name must be a non-empty string/);
  const invalidUsage = structuredClone(value.snapshot);
  invalidUsage.usage.summary.last_use = "not-a-date";
  assert.throws(() => validateSnapshot(invalidUsage), /last_use must be null or a valid date/);
  fs.rmSync(value.root, { recursive: true });
});

test("rejects missing manuscripts and content digest mismatches", () => {
  const value = fixture();
  const missing = structuredClone(value.snapshot);
  missing.manuscripts = [];
  assert.throws(() => validateSnapshot(missing), /exactly one manuscript/);

  const changed = structuredClone(value.snapshot);
  changed.manuscripts[0].content = "# Changed\n";
  changed.manuscripts[0].size = Buffer.byteLength(changed.manuscripts[0].content);
  assert.throws(() => validateSnapshot(changed), /content digest/);
  fs.rmSync(value.root, { recursive: true });
});

test("rejects incomplete group and installation usage relationships", () => {
  const value = fixture();
  const missingGroup = structuredClone(value.snapshot);
  missingGroup.catalog.canonical_groups = [];
  missingGroup.catalog.counts.canonical_groups = 0;
  assert.throws(() => validateSnapshot(missingGroup), /group every installation exactly once/);

  const wrongGroup = structuredClone(value.snapshot);
  wrongGroup.catalog.canonical_groups[0].canonical_group_id = "other-group";
  assert.throws(() => validateSnapshot(wrongGroup), /does not match installation/);

  const missingUsage = structuredClone(value.snapshot);
  missingUsage.usage.installation_usage = [];
  assert.throws(() => validateSnapshot(missingUsage), /one usage row for every installation/);
  fs.rmSync(value.root, { recursive: true });
});

test("installs atomically and retains the prior valid source snapshot", () => {
  const first = fixture({ generatedAt: "2026-09-07T10:00:00Z" });
  const second = fixture({ generatedAt: "2026-09-07T12:00:00Z" });
  const directory = path.join(first.root, "published");
  const firstFile = path.join(first.root, "first.json");
  const secondFile = path.join(second.root, "second.json");
  writeSnapshotAtomic(first.snapshot, firstFile);
  writeSnapshotAtomic(second.snapshot, secondFile);
  assert.equal(installSnapshot(firstFile, directory).previous, null);
  const result = installSnapshot(secondFile, directory);
  assert.equal(JSON.parse(fs.readFileSync(result.target)).generated_at, "2026-09-07T12:00:00Z");
  assert.equal(JSON.parse(fs.readFileSync(result.previous)).generated_at, "2026-09-07T10:00:00Z");
  fs.rmSync(first.root, { recursive: true });
  fs.rmSync(second.root, { recursive: true });
});

test("snapshot generation does not follow the legacy predictable temporary path", () => {
  const value = fixture();
  const output = path.join(value.root, "published.json");
  const victim = path.join(value.root, "victim.txt");
  const legacyTemporary = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(victim, "keep me\n");
  fs.symlinkSync(victim, legacyTemporary);

  writeSnapshotAtomic(value.snapshot, output);

  assert.equal(fs.readFileSync(victim, "utf8"), "keep me\n");
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).source_id, "devbox");
  fs.unlinkSync(legacyTemporary);
  fs.rmSync(value.root, { recursive: true });
});

test("merges sources with isolated identities, aggregate usage, and visible conflicts", () => {
  const devbox = fixture({
    sourceId: "devbox",
    content: "# Devbox sample\n",
    generatedAt: "2026-09-07T12:00:00Z",
    currencyCheckedAt: "2026-09-07T11:00:00Z",
  });
  const lenovo = fixture({
    sourceId: "lenovo",
    content: "# Lenovo sample\n",
    generatedAt: "2026-08-20T12:00:00Z",
    currencyCheckedAt: "2026-08-20T11:00:00Z",
  });
  const directory = path.join(devbox.root, "published");
  const devboxFile = path.join(devbox.root, "devbox-input.json");
  const lenovoFile = path.join(lenovo.root, "lenovo-input.json");
  writeSnapshotAtomic(devbox.snapshot, devboxFile);
  writeSnapshotAtomic(lenovo.snapshot, lenovoFile);
  installSnapshot(devboxFile, directory);
  installSnapshot(lenovoFile, directory);
  const runtime = loadSnapshotDirectory(directory, { now: new Date("2026-09-07T13:00:00Z"), staleAfterDays: 7 });
  assert.deepEqual(runtime.catalog.installations.map((row) => row.installation_id), ["devbox::install-1", "lenovo::install-1"]);
  assert.equal(runtime.catalog.inventory.counts.canonical_groups, 1);
  assert.deepEqual(runtime.catalog.groupsById.get("group-1").source_ids, ["devbox", "lenovo"]);
  assert.equal(runtime.usageStore.aggregates().summary.invocations, 2);
  assert.deepEqual(runtime.usageStore.aggregates().by_skill.map((row) => row.key), ["devbox::install-1", "lenovo::install-1"]);
  assert.equal(
    runtime.usageStore.forInstallation("devbox::install-1").installation_id,
    "devbox::install-1",
  );
  assert.equal(
    runtime.usageStore.forInstallation("lenovo::install-1").installation_id,
    "lenovo::install-1",
  );
  assert.equal(runtime.catalog.conflicts[0].skill_id, "sample");
  assert.deepEqual(runtime.catalog.sourceHealth.map((row) => row.status), ["current", "stale"]);
  assert.deepEqual(
    runtime.catalog.installations.map((row) => row.currency_checked_at),
    ["2026-09-07T11:00:00Z", "2026-08-20T11:00:00Z"],
  );
  assert.equal(runtime.catalog.currency.checked_at, "2026-09-07T11:00:00Z");
  assert.equal(readCatalogFile(runtime.catalog, runtime.catalog.installations[0], "SKILL.md").content, "# Devbox sample\n");
  assert.throws(() => readCatalogFile(runtime.catalog, runtime.catalog.installations[0], "private.txt"), /not found/);
  fs.rmSync(devbox.root, { recursive: true });
  fs.rmSync(lenovo.root, { recursive: true });
});

test("does not report same-name groups on one source as a source conflict", () => {
  const value = fixture();
  const snapshot = structuredClone(value.snapshot);
  const secondContent = "# Second sample\n";
  snapshot.catalog.installations.push({
    ...snapshot.catalog.installations[0],
    installation_id: "install-2",
    canonical_group_id: "group-2",
    content_sha256: sha256(secondContent),
  });
  snapshot.catalog.canonical_groups.push({
    ...snapshot.catalog.canonical_groups[0],
    canonical_group_id: "group-2",
    installation_ids: ["install-2"],
  });
  snapshot.catalog.counts = { installations: 2, canonical_groups: 2 };
  snapshot.usage.installation_usage.push({
    installation_id: "install-2",
    invocations: 0,
    unique_sessions: 0,
    last_use: null,
    by_cli: [],
    by_repository: [],
  });
  snapshot.manuscripts.push({
    ...snapshot.manuscripts[0],
    installation_id: "install-2",
    content: secondContent,
    size: Buffer.byteLength(secondContent),
  });
  const directory = path.join(value.root, "published");
  const file = path.join(value.root, "input.json");
  writeSnapshotAtomic(snapshot, file);
  installSnapshot(file, directory);
  assert.deepEqual(loadSnapshotDirectory(directory).catalog.conflicts, []);
  fs.rmSync(value.root, { recursive: true });
});

test("does not report a conflict when source digest sets match", () => {
  const devbox = fixture({ sourceId: "devbox" });
  const lenovo = fixture({ sourceId: "lenovo" });
  const addVariant = (snapshot, content) => {
    const installation = snapshot.catalog.installations[0];
    snapshot.catalog.installations.push({
      ...installation,
      installation_id: "install-2",
      content_sha256: sha256(content),
    });
    snapshot.catalog.canonical_groups[0].installation_ids.push("install-2");
    snapshot.catalog.counts.installations += 1;
    snapshot.usage.installation_usage.push({
      installation_id: "install-2",
      invocations: 0,
      unique_sessions: 0,
      last_use: null,
      by_cli: [],
      by_repository: [],
    });
    snapshot.manuscripts.push({
      installation_id: "install-2",
      path: "SKILL.md",
      size: Buffer.byteLength(content),
      content,
    });
  };
  addVariant(devbox.snapshot, "# Variant\n");
  addVariant(lenovo.snapshot, "# Variant\n");
  const directory = path.join(devbox.root, "published");
  const devboxFile = path.join(devbox.root, "devbox.json");
  const lenovoFile = path.join(lenovo.root, "lenovo.json");
  writeSnapshotAtomic(devbox.snapshot, devboxFile);
  writeSnapshotAtomic(lenovo.snapshot, lenovoFile);
  installSnapshot(devboxFile, directory);
  installSnapshot(lenovoFile, directory);

  assert.deepEqual(loadSnapshotDirectory(directory).catalog.conflicts, []);
  fs.rmSync(devbox.root, { recursive: true });
  fs.rmSync(lenovo.root, { recursive: true });
});

test("rejects duplicate source IDs before merge", () => {
  const value = fixture();
  const directory = path.join(value.root, "duplicates");
  fs.mkdirSync(directory);
  writeSnapshotAtomic(value.snapshot, path.join(directory, "one.json"));
  writeSnapshotAtomic(value.snapshot, path.join(directory, "two.json"));
  assert.throws(() => loadSnapshotDirectory(directory), /Duplicate snapshot source ID/);
  fs.rmSync(value.root, { recursive: true });
});
