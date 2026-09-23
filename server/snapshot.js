import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readRegisteredFile } from "./catalog.js";


export const SNAPSHOT_SCHEMA_VERSION = 1;

const ROOT_FIELDS = new Set([
  "schema_version", "source_id", "generated_at", "catalog", "usage", "manuscripts",
]);
const CATALOG_FIELDS = new Set([
  "currency_checked_at", "counts", "installations", "canonical_groups",
]);
const COUNT_FIELDS = new Set(["installations", "canonical_groups"]);
const INSTALLATION_FIELDS = new Set([
  "canonical_group_id", "cli", "content_sha256", "description", "display_name",
  "governance", "governance_owner", "installation_id", "location", "ownership",
  "real_location", "repository", "scope", "skill_id", "source", "tracking_issue",
  "currency",
]);
const GROUP_FIELDS = new Set([
  "canonical_group_id", "description", "display_name", "installation_ids", "skill_id",
]);
const CURRENCY_FIELDS = new Set([
  "action", "installed", "latest", "mechanism", "name", "ownership", "status",
  "target", "upstream",
]);
const USAGE_FIELDS = new Set([
  "summary", "by_cli", "by_skill", "by_scope", "by_repository", "by_day",
  "by_occurrence_evidence", "by_identity_resolution", "adapter_health",
  "installation_usage",
]);
const SUMMARY_FIELDS = new Set([
  "invocations", "unique_sessions", "last_use", "unassigned_exact",
]);
const AGGREGATE_FIELDS = new Set([
  "key", "invocations", "unique_sessions", "last_use", "occurrence_evidence",
  "identity_resolution",
]);
const ADAPTER_FIELDS = new Set([
  "adapter", "last_import_at", "imported", "duplicates", "errors",
]);
const INSTALLATION_USAGE_FIELDS = new Set([
  "installation_id", "invocations", "unique_sessions", "last_use", "by_cli",
  "by_repository",
]);
const MANUSCRIPT_FIELDS = new Set(["installation_id", "path", "size", "content"]);

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertFields(value, allowed, label) {
  assertRecord(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains forbidden field: ${key}`);
  }
}

function assertRows(value, label, allowed) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  value.forEach((row, index) => assertFields(row, allowed, `${label}[${index}]`));
}

function assertScalarValues(value, label, exceptions = new Set()) {
  for (const [key, item] of Object.entries(value)) {
    if (exceptions.has(key) || item == null) continue;
    if (!["string", "number", "boolean"].includes(typeof item)) {
      throw new Error(`${label}.${key} must be a scalar value`);
    }
  }
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).valueOf());
}

function contentSha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function assertString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value)) {
    throw new Error(`${label} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
}

function assertOptionalDate(value, label) {
  if (value != null && !validDate(value)) throw new Error(`${label} must be null or a valid date`);
}

function assertAggregate(row, label) {
  assertString(row.key, `${label}.key`);
  assertCount(row.invocations, `${label}.invocations`);
  assertCount(row.unique_sessions, `${label}.unique_sessions`);
  assertOptionalDate(row.last_use, `${label}.last_use`);
  for (const field of ["occurrence_evidence", "identity_resolution"]) {
    if (row[field] !== undefined) assertString(row[field], `${label}.${field}`);
  }
}

function pick(record, fields) {
  return Object.fromEntries([...fields].filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

function safeAggregateRows(rows = []) {
  return rows.map((row) => pick(row, AGGREGATE_FIELDS));
}

export function validateSnapshot(snapshot) {
  assertFields(snapshot, ROOT_FIELDS, "snapshot");
  if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("Snapshot has an unsupported schema version");
  }
  if (typeof snapshot.source_id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(snapshot.source_id)) {
    throw new Error("Snapshot source ID must use lower-case letters, numbers, dots, dashes, or underscores");
  }
  if (!validDate(snapshot.generated_at)) throw new Error("Snapshot has an invalid generation time");

  assertFields(snapshot.catalog, CATALOG_FIELDS, "snapshot catalog");
  assertFields(snapshot.catalog.counts, COUNT_FIELDS, "snapshot catalog counts");
  assertCount(snapshot.catalog.counts.installations, "snapshot installation count");
  assertCount(snapshot.catalog.counts.canonical_groups, "snapshot group count");
  if (!validDate(snapshot.catalog.currency_checked_at)) throw new Error("Snapshot has an invalid currency check time");
  assertRows(snapshot.catalog.installations, "snapshot installations", INSTALLATION_FIELDS);
  assertRows(snapshot.catalog.canonical_groups, "snapshot canonical groups", GROUP_FIELDS);
  if (snapshot.catalog.counts.installations !== snapshot.catalog.installations.length) {
    throw new Error("Snapshot installation count does not match its rows");
  }
  if (snapshot.catalog.counts.canonical_groups !== snapshot.catalog.canonical_groups.length) {
    throw new Error("Snapshot group count does not match its rows");
  }
  const installationIds = new Set();
  const installationsById = new Map();
  for (const [index, row] of snapshot.catalog.installations.entries()) {
    const label = `snapshot installations[${index}]`;
    assertScalarValues(row, label, new Set(["currency"]));
    for (const field of [
      "installation_id", "canonical_group_id", "skill_id", "display_name",
      "location", "real_location", "scope", "cli", "ownership", "governance",
      "source",
    ]) {
      assertString(row[field], `${label}.${field}`);
    }
    for (const field of ["description", "repository", "governance_owner", "tracking_issue"]) {
      assertString(row[field], `${label}.${field}`, { allowEmpty: true });
    }
    if (installationIds.has(row.installation_id)) throw new Error(`Duplicate snapshot installation ID: ${row.installation_id}`);
    installationIds.add(row.installation_id);
    installationsById.set(row.installation_id, row);
    if (typeof row.content_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.content_sha256)) {
      throw new Error(`snapshot installations[${index}] has invalid content_sha256`);
    }
    assertFields(row.currency, CURRENCY_FIELDS, `snapshot installations[${index}].currency`);
    assertScalarValues(row.currency, `snapshot installations[${index}].currency`);
    for (const field of CURRENCY_FIELDS) {
      assertString(row.currency[field], `snapshot installations[${index}].currency.${field}`);
    }
  }
  const groupIds = new Set();
  const groupedInstallationIds = new Set();
  for (const [index, row] of snapshot.catalog.canonical_groups.entries()) {
    assertScalarValues(row, `snapshot canonical groups[${index}]`, new Set(["installation_ids"]));
    for (const field of ["canonical_group_id", "skill_id", "display_name"]) {
      assertString(row[field], `snapshot canonical groups[${index}].${field}`);
    }
    assertString(row.description, `snapshot canonical groups[${index}].description`, { allowEmpty: true });
    if (!Array.isArray(row.installation_ids) || !row.installation_ids.length) {
      throw new Error(`snapshot canonical groups[${index}] is incomplete`);
    }
    row.installation_ids.forEach((id) => assertString(id, `snapshot canonical groups[${index}].installation_ids`));
    if (groupIds.has(row.canonical_group_id)) throw new Error(`Duplicate snapshot group ID: ${row.canonical_group_id}`);
    groupIds.add(row.canonical_group_id);
    if (row.installation_ids.some((id) => !installationIds.has(id))) {
      throw new Error(`snapshot canonical groups[${index}] refers to an unknown installation`);
    }
    for (const installationId of row.installation_ids) {
      if (groupedInstallationIds.has(installationId)) {
        throw new Error(`Snapshot installation appears in more than one canonical group: ${installationId}`);
      }
      const installation = installationsById.get(installationId);
      if (
        installation.canonical_group_id !== row.canonical_group_id
        || installation.skill_id !== row.skill_id
      ) {
        throw new Error(`snapshot canonical groups[${index}] does not match installation ${installationId}`);
      }
      groupedInstallationIds.add(installationId);
    }
  }
  if (groupedInstallationIds.size !== installationIds.size) {
    throw new Error("Snapshot must group every installation exactly once");
  }

  assertFields(snapshot.usage, USAGE_FIELDS, "snapshot usage");
  assertFields(snapshot.usage.summary, SUMMARY_FIELDS, "snapshot usage summary");
  assertScalarValues(snapshot.usage.summary, "snapshot usage summary");
  for (const field of ["invocations", "unique_sessions", "unassigned_exact"]) {
    assertCount(snapshot.usage.summary[field], `snapshot usage summary ${field}`);
  }
  assertOptionalDate(snapshot.usage.summary.last_use, "snapshot usage summary last_use");
  for (const field of [
    "by_cli", "by_skill", "by_scope", "by_repository", "by_day",
    "by_occurrence_evidence", "by_identity_resolution",
  ]) {
    assertRows(snapshot.usage[field], `snapshot usage ${field}`, AGGREGATE_FIELDS);
    snapshot.usage[field].forEach((row, index) => {
      const label = `snapshot usage ${field}[${index}]`;
      assertScalarValues(row, label);
      assertAggregate(row, label);
    });
  }
  assertRows(snapshot.usage.adapter_health, "snapshot adapter health", ADAPTER_FIELDS);
  snapshot.usage.adapter_health.forEach((row, index) => {
    const label = `snapshot adapter health[${index}]`;
    assertScalarValues(row, label);
    assertString(row.adapter, `${label}.adapter`);
    assertOptionalDate(row.last_import_at, `${label}.last_import_at`);
    for (const field of ["imported", "duplicates", "errors"]) assertCount(row[field], `${label}.${field}`);
  });
  assertRows(snapshot.usage.installation_usage, "snapshot installation usage", INSTALLATION_USAGE_FIELDS);
  const usageInstallationIds = new Set();
  for (const [index, row] of snapshot.usage.installation_usage.entries()) {
    assertScalarValues(row, `snapshot installation usage[${index}]`, new Set(["by_cli", "by_repository"]));
    assertString(row.installation_id, `snapshot installation usage[${index}].installation_id`);
    if (!installationIds.has(row.installation_id)) {
      throw new Error(`snapshot installation usage[${index}] refers to an unknown installation`);
    }
    if (usageInstallationIds.has(row.installation_id)) {
      throw new Error(`Duplicate snapshot installation usage: ${row.installation_id}`);
    }
    usageInstallationIds.add(row.installation_id);
    assertCount(row.invocations, `snapshot installation usage[${index}].invocations`);
    assertCount(row.unique_sessions, `snapshot installation usage[${index}].unique_sessions`);
    assertOptionalDate(row.last_use, `snapshot installation usage[${index}].last_use`);
    assertRows(row.by_cli, `snapshot installation usage[${index}].by_cli`, AGGREGATE_FIELDS);
    assertRows(row.by_repository, `snapshot installation usage[${index}].by_repository`, AGGREGATE_FIELDS);
    row.by_cli.forEach((item, rowIndex) => assertAggregate(item, `snapshot installation usage[${index}].by_cli[${rowIndex}]`));
    row.by_repository.forEach((item, rowIndex) => assertAggregate(item, `snapshot installation usage[${index}].by_repository[${rowIndex}]`));
  }
  if (usageInstallationIds.size !== installationIds.size) {
    throw new Error("Snapshot must contain exactly one usage row for every installation");
  }

  assertRows(snapshot.manuscripts, "snapshot manuscripts", MANUSCRIPT_FIELDS);
  const manuscripts = new Set();
  for (const [index, manuscript] of snapshot.manuscripts.entries()) {
    assertScalarValues(manuscript, `snapshot manuscripts[${index}]`);
    if (!installationIds.has(manuscript.installation_id)) {
      throw new Error(`snapshot manuscripts[${index}] refers to an unknown installation`);
    }
    if (manuscripts.has(manuscript.installation_id)) {
      throw new Error(`Duplicate snapshot manuscript: ${manuscript.installation_id}`);
    }
    manuscripts.add(manuscript.installation_id);
    if (manuscript.path !== "SKILL.md" || typeof manuscript.content !== "string") {
      throw new Error(`snapshot manuscripts[${index}] must contain only SKILL.md text`);
    }
    if (Buffer.byteLength(manuscript.content) !== manuscript.size) {
      throw new Error(`snapshot manuscripts[${index}] size does not match its content`);
    }
    assertCount(manuscript.size, `snapshot manuscripts[${index}].size`);
    const installation = installationsById.get(manuscript.installation_id);
    if (contentSha256(manuscript.content) !== installation.content_sha256) {
      throw new Error(`snapshot manuscripts[${index}] content digest does not match its installation`);
    }
  }
  if (manuscripts.size !== installationIds.size) {
    throw new Error("Snapshot must contain exactly one manuscript for every installation");
  }
  return snapshot;
}

export function createSnapshot({ sourceId, catalog, usageStore, generatedAt = new Date().toISOString() }) {
  const aggregates = usageStore.aggregates();
  const installations = catalog.installations.map((row) => ({
    ...pick(row, INSTALLATION_FIELDS),
    currency: pick(row.currency || {}, CURRENCY_FIELDS),
  }));
  const snapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    source_id: sourceId,
    generated_at: generatedAt,
    catalog: {
      currency_checked_at: catalog.currency.checked_at,
      counts: {
        installations: installations.length,
        canonical_groups: catalog.inventory.canonical_groups.length,
      },
      installations,
      canonical_groups: catalog.inventory.canonical_groups.map((row) => pick(row, GROUP_FIELDS)),
    },
    usage: {
      summary: {
        invocations: aggregates.summary.invocations || 0,
        unique_sessions: aggregates.summary.unique_sessions || 0,
        last_use: aggregates.summary.last_use || null,
        unassigned_exact: aggregates.summary.unassigned_exact || 0,
      },
      by_cli: safeAggregateRows(aggregates.by_cli),
      by_skill: safeAggregateRows(aggregates.by_skill),
      by_scope: safeAggregateRows(aggregates.by_scope),
      by_repository: safeAggregateRows(aggregates.by_repository),
      by_day: safeAggregateRows(aggregates.by_day),
      by_occurrence_evidence: safeAggregateRows(aggregates.by_occurrence_evidence),
      by_identity_resolution: safeAggregateRows(aggregates.by_identity_resolution),
      adapter_health: (aggregates.adapter_health || []).map((row) => pick(row, ADAPTER_FIELDS)),
      installation_usage: installations.map((row) => {
        const usage = usageStore.forInstallation(row.installation_id);
        return {
          installation_id: row.installation_id,
          ...pick(usage, new Set(["invocations", "unique_sessions", "last_use"])),
          by_cli: safeAggregateRows(usage.by_cli),
          by_repository: safeAggregateRows(usage.by_repository),
        };
      }),
    },
    manuscripts: catalog.installations.map((row) => {
      const manuscript = readRegisteredFile(row, "SKILL.md");
      return pick({ installation_id: row.installation_id, ...manuscript }, MANUSCRIPT_FIELDS);
    }),
  };
  return validateSnapshot(snapshot);
}

export function writeSnapshotAtomic(snapshot, outputPath) {
  validateSnapshot(snapshot);
  const directory = path.dirname(outputPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryDirectory = fs.mkdtempSync(
    path.join(directory, `.${path.basename(outputPath)}.`),
  );
  const temporary = path.join(temporaryDirectory, "snapshot");
  let descriptor;
  try {
    const flags = fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(temporary, flags, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(snapshot, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, outputPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.rmdirSync(temporaryDirectory);
  }
}

export function installSnapshot(inputPath, snapshotDirectory) {
  const snapshot = validateSnapshot(JSON.parse(fs.readFileSync(inputPath, "utf8")));
  fs.mkdirSync(snapshotDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(snapshotDirectory, `${snapshot.source_id}.json`);
  const previous = path.join(snapshotDirectory, `${snapshot.source_id}.previous`);
  const temporary = path.join(snapshotDirectory, `.${snapshot.source_id}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  if (fs.existsSync(target)) fs.copyFileSync(target, previous);
  fs.renameSync(temporary, target);
  return { sourceId: snapshot.source_id, target, previous: fs.existsSync(previous) ? previous : null };
}

function mergeDate(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return new Date(left) >= new Date(right) ? left : right;
}

function mergeAggregateRows(rows, keyTransform = (_sourceId, key) => key) {
  const merged = new Map();
  for (const { sourceId, row } of rows) {
    const key = keyTransform(sourceId, row.key);
    const current = merged.get(key) || { key, invocations: 0, unique_sessions: 0, last_use: null };
    current.invocations += row.invocations || 0;
    current.unique_sessions += row.unique_sessions || 0;
    current.last_use = mergeDate(current.last_use, row.last_use);
    for (const field of ["occurrence_evidence", "identity_resolution"]) {
      if (!row[field]) continue;
      const values = new Set([...(current[field] || "").split(",").filter(Boolean), ...String(row[field]).split(",")]);
      current[field] = [...values].sort().join(",");
    }
    merged.set(key, current);
  }
  return [...merged.values()].sort((a, b) => b.invocations - a.invocations || String(a.key).localeCompare(String(b.key)));
}

function prefix(sourceId, value) {
  return `${sourceId}::${value}`;
}

function loadSnapshotFile(file) {
  return validateSnapshot(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function loadSnapshotDirectory(snapshotDirectory, { now = new Date(), staleAfterDays = 7 } = {}) {
  const files = fs.readdirSync(snapshotDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(snapshotDirectory, name));
  if (!files.length) throw new Error("The snapshot directory has no source snapshots");
  const snapshots = files.map(loadSnapshotFile);
  const sourceIds = new Set();
  for (const snapshot of snapshots) {
    if (sourceIds.has(snapshot.source_id)) throw new Error(`Duplicate snapshot source ID: ${snapshot.source_id}`);
    sourceIds.add(snapshot.source_id);
  }

  const installations = [];
  const groupMap = new Map();
  const groupConflicts = [];
  const embeddedFiles = new Map();
  const installationUsage = new Map();
  const aggregateFields = [
    "by_cli", "by_skill", "by_scope", "by_repository", "by_day",
    "by_occurrence_evidence", "by_identity_resolution",
  ];
  const aggregateRows = Object.fromEntries(aggregateFields.map((field) => [field, []]));
  const summary = { invocations: 0, unique_sessions: 0, last_use: null, unassigned_exact: 0 };
  const adapterHealth = [];

  for (const snapshot of snapshots) {
    const sourceId = snapshot.source_id;
    for (const row of snapshot.catalog.installations) {
      installations.push({
        ...row,
        source_id: sourceId,
        source_generated_at: snapshot.generated_at,
        currency_checked_at: snapshot.catalog.currency_checked_at,
        local_installation_id: row.installation_id,
        installation_id: prefix(sourceId, row.installation_id),
      });
    }
    for (const row of snapshot.catalog.canonical_groups) {
      const existing = groupMap.get(row.canonical_group_id);
      if (existing && existing.skill_id !== row.skill_id) {
        groupConflicts.push({
          canonical_group_id: row.canonical_group_id,
          sources: [...existing.source_ids, sourceId].sort(),
          skill_ids: [existing.skill_id, row.skill_id].sort(),
        });
      }
      if (existing) {
        existing.source_ids = [...new Set([...existing.source_ids, sourceId])].sort();
        existing.installation_ids.push(...row.installation_ids.map((id) => prefix(sourceId, id)));
      } else {
        groupMap.set(row.canonical_group_id, {
          ...row,
          source_ids: [sourceId],
          installation_ids: row.installation_ids.map((id) => prefix(sourceId, id)),
        });
      }
    }
    for (const row of snapshot.manuscripts) {
      embeddedFiles.set(prefix(sourceId, row.installation_id), [{ path: row.path, size: row.size, content: row.content }]);
    }
    for (const row of snapshot.usage.installation_usage) {
      const installationId = prefix(sourceId, row.installation_id);
      installationUsage.set(installationId, {
        ...row,
        installation_id: installationId,
      });
    }
    for (const field of aggregateFields) {
      snapshot.usage[field].forEach((row) => aggregateRows[field].push({ sourceId, row }));
    }
    summary.invocations += snapshot.usage.summary.invocations;
    summary.unique_sessions += snapshot.usage.summary.unique_sessions;
    summary.unassigned_exact += snapshot.usage.summary.unassigned_exact;
    summary.last_use = mergeDate(summary.last_use, snapshot.usage.summary.last_use);
    adapterHealth.push(...snapshot.usage.adapter_health.map((row) => ({ ...row, source_id: sourceId })));
  }

  const contentByGroup = new Map();
  for (const row of installations) {
    const values = contentByGroup.get(row.canonical_group_id) || [];
    values.push({ source_id: row.source_id, skill_id: row.skill_id, content_sha256: row.content_sha256 });
    contentByGroup.set(row.canonical_group_id, values);
  }
  const conflicts = [...contentByGroup.entries()].flatMap(([groupId, rows]) => {
    const digests = new Set(rows.map((row) => row.content_sha256).filter(Boolean));
    const sources = new Set(rows.map((row) => row.source_id));
    const digestsBySource = new Map();
    for (const row of rows) {
      const sourceDigests = digestsBySource.get(row.source_id) || new Set();
      if (row.content_sha256) sourceDigests.add(row.content_sha256);
      digestsBySource.set(row.source_id, sourceDigests);
    }
    const sourceSignatures = new Set(
      [...digestsBySource.values()].map((values) => [...values].sort().join("\0")),
    );
    if (sources.size < 2 || sourceSignatures.size < 2) return [];
    return [{
      canonical_group_id: groupId,
      skill_id: rows[0].skill_id,
      sources: [...sources].sort(),
      content_sha256: [...digests].sort(),
    }];
  }).concat(groupConflicts);
  const sourceHealth = snapshots.map((snapshot) => {
    const ageDays = (now.valueOf() - new Date(snapshot.generated_at).valueOf()) / 86_400_000;
    return {
      source_id: snapshot.source_id,
      generated_at: snapshot.generated_at,
      currency_checked_at: snapshot.catalog.currency_checked_at,
      status: ageDays > staleAfterDays ? "stale" : "current",
    };
  });

  const groups = [...groupMap.values()].sort((a, b) => a.canonical_group_id.localeCompare(b.canonical_group_id));
  const groupsById = new Map(groups.map((row) => [row.canonical_group_id, row]));
  const byId = new Map(installations.map((row) => [row.installation_id, row]));
  const usage = {
    summary,
    by_cli: mergeAggregateRows(aggregateRows.by_cli),
    by_skill: mergeAggregateRows(aggregateRows.by_skill, prefix),
    by_scope: mergeAggregateRows(aggregateRows.by_scope),
    by_repository: mergeAggregateRows(aggregateRows.by_repository),
    by_day: mergeAggregateRows(aggregateRows.by_day),
    by_occurrence_evidence: mergeAggregateRows(aggregateRows.by_occurrence_evidence),
    by_identity_resolution: mergeAggregateRows(aggregateRows.by_identity_resolution),
    adapter_health: adapterHealth,
  };
  return {
    catalog: {
      snapshotDirectory,
      inventory: {
        schema_version: 1,
        counts: { installations: installations.length, canonical_groups: groups.length },
        installations,
        canonical_groups: groups,
      },
      currency: {
        checked_at: snapshots.reduce(
          (latest, row) => mergeDate(latest, row.catalog.currency_checked_at),
          null,
        ),
      },
      installations,
      byId,
      groupsById,
      embeddedFiles,
      loadedAt: now.toISOString(),
      sourceHealth,
      conflicts,
    },
    usageStore: {
      dbPath: null,
      recovered: false,
      recoveryPath: null,
      aggregates: () => usage,
      forInstallation: (installationId) => installationUsage.get(installationId) || {
        invocations: 0, unique_sessions: 0, last_use: null, by_cli: [], by_repository: [],
      },
      close: () => {},
    },
  };
}
