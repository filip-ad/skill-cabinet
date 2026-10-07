import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";


const EVENT_FIELDS = new Set([
  "source_id",
  "occurred_at",
  "cli",
  "session_id",
  "session_hash",
  "skill_path",
  "skill_name",
  "repository",
  "adapter",
  "parser_version",
  "occurrence_evidence",
]);
const COUNTED_PROVIDER_ADAPTERS = "adapter IN ('claude', 'kimi', 'codex')";

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function friendlyPath(value) {
  const home = os.homedir().replace(/\\/g, "/");
  const normalized = String(value || "").replace(/\\/g, "/");
  return normalized === home ? "~" : normalized.startsWith(`${home}/`) ? `~${normalized.slice(home.length)}` : normalized;
}

function cliMatches(installation, cli) {
  if (installation.cli === "shared" || installation.cli === "all") return true;
  if (installation.cli === "repository") return true;
  return installation.cli === cli;
}

function locationMatchesCli(installation, cli) {
  const location = installation.location || "";
  if (cli === "claude") return location.includes("/.claude/skills/");
  if (cli === "codex") return location.includes("/.codex/skills/") || location.includes("/.agents/skills/");
  if (cli === "kimi") return location.includes("/.kimi-code/skills/") || location.includes("/.agents/skills/");
  if (cli === "antigravity") return location.includes("/.gemini/antigravity/skills/");
  return false;
}

export function resolveIdentity(event, inventory) {
  const installations = inventory.installations || [];
  if (event.skill_path) {
    const requested = friendlyPath(event.skill_path);
    const lexicalMatches = installations.filter((row) => row.location === requested);
    if (lexicalMatches.length === 1) {
      return { status: "resolved", installation: lexicalMatches[0] };
    }
    const matches = lexicalMatches.length
      ? lexicalMatches
      : installations.filter((row) => row.real_location === requested);
    if (matches.length === 1) {
      return { status: "resolved", installation: matches[0] };
    }
    return { status: matches.length ? "ambiguous" : "unresolved", installation: null };
  }
  const repository = friendlyPath(event.repository);
  const matches = installations.filter((row) => {
    if (row.skill_id !== event.skill_name && row.display_name !== event.skill_name) return false;
    if (!cliMatches(row, event.cli)) return false;
    if (row.scope === "repo-local") return repository ? row.repository === repository : true;
    return true;
  });
  if (!repository && matches.some((row) => row.scope === "repo-local")) {
    return {
      status: matches.length === 1 ? "unresolved" : "ambiguous",
      installation: null,
    };
  }
  const repositoryMatches = repository
    ? matches.filter((row) => row.scope === "repo-local" && row.repository === repository)
    : [];
  const scopedMatches = repositoryMatches.length ? repositoryMatches : matches;
  const preferences = [
    (row) => row.cli === event.cli,
    (row) => locationMatchesCli(row, event.cli),
    (row) => row.cli === "shared",
    (row) => row.cli === "all",
  ];
  let preferredMatches = scopedMatches;
  for (const preference of preferences) {
    const candidates = preferredMatches.filter(preference);
    if (candidates.length) {
      preferredMatches = candidates;
      break;
    }
  }
  if (preferredMatches.length === 1) {
    return { status: "resolved", installation: preferredMatches[0] };
  }
  return { status: preferredMatches.length ? "ambiguous" : "unresolved", installation: null };
}

export function normalizeEvent(raw, inventory) {
  for (const key of Object.keys(raw)) {
    if (!EVENT_FIELDS.has(key)) {
      throw new Error(`Usage event contains forbidden field: ${key}`);
    }
  }
  const occurredAt = new Date(raw.occurred_at);
  if (!raw.occurred_at || Number.isNaN(occurredAt.valueOf())) {
    throw new Error("Usage event has an invalid time");
  }
  if (!raw.cli || (!raw.skill_path && !raw.skill_name)) {
    throw new Error("Usage event needs a CLI and a skill path or name");
  }
  const occurrence = raw.occurrence_evidence || "exact";
  if (!new Set(["exact", "inferred"]).has(occurrence)) {
    throw new Error("Usage event has invalid occurrence evidence");
  }
  const resolution = resolveIdentity(raw, inventory);
  const sessionHash = raw.session_hash || digest(raw.session_id || "unknown-session");
  const eventId = digest(
    [
      raw.adapter || "recorder",
      raw.source_id || "",
      occurredAt.toISOString(),
      raw.cli,
      sessionHash,
      raw.skill_path || raw.skill_name,
    ].join("\0"),
  );
  return {
    event_id: eventId,
    occurred_at: occurredAt.toISOString(),
    cli: String(raw.cli),
    session_hash: sessionHash,
    skill_path: raw.skill_path ? friendlyPath(raw.skill_path) : null,
    skill_name: raw.skill_name || resolution.installation?.skill_id || null,
    repository: raw.repository ? friendlyPath(raw.repository) : null,
    adapter: raw.adapter || "recorder",
    parser_version: raw.parser_version || "1",
    occurrence_evidence: occurrence,
    identity_resolution: resolution.status,
    installation_id: resolution.installation?.installation_id || null,
    canonical_group_id: resolution.installation?.canonical_group_id || null,
    scope: resolution.installation?.scope || null,
  };
}

function initialize(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      cli TEXT NOT NULL,
      session_hash TEXT NOT NULL,
      skill_path TEXT,
      skill_name TEXT,
      repository TEXT,
      adapter TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      occurrence_evidence TEXT NOT NULL CHECK (occurrence_evidence IN ('exact', 'inferred')),
      identity_resolution TEXT NOT NULL CHECK (identity_resolution IN ('resolved', 'ambiguous', 'unresolved')),
      installation_id TEXT,
      canonical_group_id TEXT,
      scope TEXT
    );
    CREATE TABLE IF NOT EXISTS adapter_health (
      adapter TEXT PRIMARY KEY,
      last_import_at TEXT NOT NULL,
      imported INTEGER NOT NULL,
      duplicates INTEGER NOT NULL,
      errors INTEGER NOT NULL,
      message TEXT NOT NULL
    );
    INSERT INTO metadata(key, value) VALUES ('schema_version', '1')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  `);
}

function openDatabase(dbPath) {
  const directory = path.dirname(path.resolve(dbPath));
  const directoryExisted = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!directoryExisted || path.basename(directory) === "skill-cabinet") {
    fs.chmodSync(directory, 0o700);
  }
  const secureFiles = (...roots) => {
    for (const root of roots.filter(Boolean)) {
      for (const suffix of ["", "-wal", "-shm"]) {
        const file = `${root}${suffix}`;
        if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
      }
    }
  };
  try {
    const db = new DatabaseSync(dbPath);
    initialize(db);
    secureFiles(dbPath);
    return { db, recovered: false, recoveryPath: null };
  } catch (error) {
    const recoveryPath = `${dbPath}.corrupt-${Date.now()}`;
    if (!fs.existsSync(dbPath)) throw error;
    fs.renameSync(dbPath, recoveryPath);
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(`${dbPath}${suffix}`)) fs.renameSync(`${dbPath}${suffix}`, `${recoveryPath}${suffix}`);
    }
    const db = new DatabaseSync(dbPath);
    initialize(db);
    secureFiles(dbPath, recoveryPath);
    return { db, recovered: true, recoveryPath };
  }
}

export class UsageStore {
  constructor({ dbPath, inventory }) {
    this.dbPath = dbPath;
    this.inventory = inventory;
    const opened = openDatabase(dbPath);
    this.db = opened.db;
    this.recovered = opened.recovered;
    this.recoveryPath = opened.recoveryPath;
    this.insert = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        event_id, occurred_at, cli, session_hash, skill_path, skill_name,
        repository, adapter, parser_version, occurrence_evidence,
        identity_resolution, installation_id, canonical_group_id, scope
      ) VALUES (
        @event_id, @occurred_at, @cli, @session_hash, @skill_path, @skill_name,
        @repository, @adapter, @parser_version, @occurrence_evidence,
        @identity_resolution, @installation_id, @canonical_group_id, @scope
      )
    `);
  }

  importEvents(rawEvents, adapter = "unknown") {
    let imported = 0;
    let duplicates = 0;
    const errors = [];
    for (const raw of rawEvents) {
      try {
        const event = normalizeEvent({ adapter, ...raw }, this.inventory);
        const result = this.insert.run(event);
        if (result.changes) imported += 1;
        else duplicates += 1;
      } catch (error) {
        errors.push(error.message);
      }
    }
    this.writeHealth(adapter, { imported, duplicates, errors });
    return { imported, duplicates, errors };
  }

  writeHealth(adapter, { imported, duplicates, errors }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO adapter_health(adapter, last_import_at, imported, duplicates, errors, message)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(adapter) DO UPDATE SET
        last_import_at=excluded.last_import_at,
        imported=excluded.imported,
        duplicates=excluded.duplicates,
        errors=excluded.errors,
        message=excluded.message
    `).run(adapter, now, imported, duplicates, errors.length, errors[0] || "ok");
  }

  importJsonlFile(filePath, adapter, parser) {
    const cursorKey = `cursor:${adapter}:${digest(path.resolve(filePath))}`;
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(cursorKey);
    const contextKey = `context:${adapter}:${digest(path.resolve(filePath))}:cwd`;
    const contextRow = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(contextKey);
    const file = fs.readFileSync(filePath);
    let offset = Number(row?.value || 0);
    if (offset > file.length) offset = 0;
    const remaining = file.subarray(offset);
    const lastNewline = remaining.lastIndexOf(10);
    if (lastNewline < 0) return { imported: 0, duplicates: 0, errors: [] };
    const complete = remaining.subarray(0, lastNewline + 1).toString("utf8");
    const records = [];
    const parseErrors = [];
    for (const [index, line] of complete.split(/\r?\n/).filter(Boolean).entries()) {
      try {
        records.push(JSON.parse(line));
      } catch {
        parseErrors.push(`Malformed JSONL record ${index + 1}`);
      }
    }
    const currentMetadata = records.find((record) => record?.type === "session_meta")?.payload;
    const sessionMetadata = {
      cwd: typeof currentMetadata?.cwd === "string" ? currentMetadata.cwd : contextRow?.value,
    };
    const result = this.importEvents(parser(records, { filePath, sessionMetadata }), adapter);
    result.errors.push(...parseErrors);
    this.writeHealth(adapter, result);
    this.db.prepare(`
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(cursorKey, String(offset + lastNewline + 1));
    if (adapter === "codex" && sessionMetadata.cwd) {
      this.db.prepare(`
        INSERT INTO metadata(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(contextKey, sessionMetadata.cwd);
    }
    return result;
  }

  importHistoryFiles(filePaths, adapter, parser) {
    const total = { imported: 0, duplicates: 0, errors: [] };
    for (const filePath of filePaths) {
      try {
        const result = this.importJsonlFile(filePath, adapter, parser);
        total.imported += result.imported;
        total.duplicates += result.duplicates;
        total.errors.push(...result.errors);
      } catch (error) {
        total.errors.push(`${friendlyPath(filePath)}: ${error.message}`);
      }
    }
    this.writeHealth(adapter, total);
    return total;
  }

  reindex() {
    const rows = this.db.prepare(`
      SELECT event_id, cli, skill_path, skill_name, repository FROM events
    `).all();
    const update = this.db.prepare(`
      UPDATE events SET identity_resolution = ?, installation_id = ?, canonical_group_id = ?, scope = ?
      WHERE event_id = ?
    `);
    let changed = 0;
    this.db.exec("BEGIN");
    try {
      for (const row of rows) {
        const resolution = resolveIdentity(row, this.inventory);
        const next = [
          resolution.status,
          resolution.installation?.installation_id || null,
          resolution.installation?.canonical_group_id || null,
          resolution.installation?.scope || null,
        ];
        const result = update.run(...next, row.event_id);
        changed += Number(result.changes || 0);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { checked: rows.length, changed };
  }

  aggregates() {
    const summary = this.db.prepare(`
      SELECT COUNT(*) AS invocations,
        COUNT(DISTINCT session_hash) AS unique_sessions,
        MAX(occurred_at) AS last_use,
        SUM(occurrence_evidence='exact' AND identity_resolution!='resolved') AS unassigned_exact
      FROM events WHERE ${COUNTED_PROVIDER_ADAPTERS}
    `).get();
    const group = (field, where = "1=1") => this.db.prepare(`
      SELECT ${field} AS key, COUNT(*) AS invocations,
        COUNT(DISTINCT session_hash) AS unique_sessions, MAX(occurred_at) AS last_use
      FROM events WHERE ${COUNTED_PROVIDER_ADAPTERS} AND ${where}
        AND ${field} IS NOT NULL AND ${field} != ''
      GROUP BY ${field} ORDER BY invocations DESC, key
    `).all();
    const bySkill = this.db.prepare(`
      SELECT installation_id AS key, COUNT(*) AS invocations,
        COUNT(DISTINCT session_hash) AS unique_sessions, MAX(occurred_at) AS last_use,
        GROUP_CONCAT(DISTINCT occurrence_evidence) AS occurrence_evidence,
        'resolved' AS identity_resolution
      FROM events WHERE ${COUNTED_PROVIDER_ADAPTERS}
        AND identity_resolution='resolved' AND installation_id IS NOT NULL
      GROUP BY installation_id ORDER BY invocations DESC, key
    `).all();
    return {
      summary,
      by_cli: group("cli"),
      by_skill: bySkill,
      by_scope: group("scope", "identity_resolution='resolved'"),
      by_repository: group("repository", "identity_resolution='resolved'"),
      by_day: group("substr(occurred_at, 1, 10)"),
      by_occurrence_evidence: group("occurrence_evidence"),
      by_identity_resolution: group("identity_resolution"),
      adapter_health: this.db.prepare("SELECT * FROM adapter_health ORDER BY adapter").all(),
    };
  }

  forInstallation(installationId) {
    const summary = this.db.prepare(`
      SELECT COUNT(*) AS invocations,
        COUNT(DISTINCT session_hash) AS unique_sessions,
        MAX(occurred_at) AS last_use
      FROM events WHERE ${COUNTED_PROVIDER_ADAPTERS}
        AND installation_id = ? AND identity_resolution='resolved'
    `).get(installationId);
    const split = (field) => this.db.prepare(`
      SELECT ${field} AS key, COUNT(*) AS invocations,
        COUNT(DISTINCT session_hash) AS unique_sessions, MAX(occurred_at) AS last_use
      FROM events
      WHERE ${COUNTED_PROVIDER_ADAPTERS}
        AND installation_id = ? AND identity_resolution='resolved'
        AND ${field} IS NOT NULL AND ${field} != ''
      GROUP BY ${field} ORDER BY invocations DESC, key
    `).all(installationId);
    return { ...summary, by_cli: split("cli"), by_repository: split("repository") };
  }

  close() {
    this.db.close();
  }
}

export function defaultUsagePath() {
  return process.env.SKILL_USAGE_DB || path.join(os.homedir(), ".local", "share", "skill-cabinet", "usage.sqlite");
}

export function parseClaudeRecords(records) {
  const events = [];
  for (const record of records) {
    const content = record?.message?.content || record?.content || [];
    for (const item of Array.isArray(content) ? content : []) {
      if (item?.type !== "tool_use" || item?.name !== "Skill") continue;
      events.push({
        source_id: item.id || record.uuid,
        occurred_at: record.timestamp,
        cli: "claude",
        session_id: record.sessionId,
        skill_name: item.input?.skill || item.input?.name,
        repository: record.cwd,
        parser_version: "claude-1",
        occurrence_evidence: "exact",
      });
    }
  }
  return events.filter((event) => event.skill_name);
}

export function parseKimiRecords(records, { filePath = "" } = {}) {
  return records.flatMap((record) => {
    const event = record?.event || record?.payload?.event;
    if (record?.type !== "context.append_loop_event" || event?.type !== "tool.call" || event?.name !== "Skill") return [];
    return [{
      source_id: event.toolCallId || event.uuid || event.id || record.id,
      occurred_at: record.timestamp || record.time,
      cli: "kimi",
      session_id: record.session_id || filePath,
      skill_name: event.arguments?.skill || event.arguments?.name || event.args?.skill,
      repository: record.cwd,
      parser_version: "kimi-2",
      occurrence_evidence: "exact",
    }];
  }).filter((event) => event.skill_name);
}

export function parseCodexRecords(records, { filePath = "", sessionMetadata = {} } = {}) {
  const pattern = /\bI(?:\s+am|['’]m)?\s+(?:using|will\s+use)\s+the\s+(?:`([^`\r\n]+)`|“([^”\r\n]+)”|"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s`'"“”]+))\s+skill\b/i;
  const metadata = records.find((record) => record?.type === "session_meta")?.payload || sessionMetadata;
  return records.flatMap((record, index) => {
    if (record?.type !== "event_msg" || record?.payload?.type !== "agent_message") return [];
    const text = record.payload.message;
    if (typeof text !== "string") return [];
    const match = text.match(pattern);
    if (!match) return [];
    return [{
      source_id: record.id || `${filePath}:${index}`,
      occurred_at: record.timestamp,
      cli: "codex",
      session_id: record.session_id || filePath,
      skill_name: match.slice(1).find(Boolean),
      repository: record.cwd || metadata.cwd,
        parser_version: "codex-visible-3",
      occurrence_evidence: "inferred",
    }];
  });
}

export function parseAntigravityRecords() {
  return [];
}

function findFiles(root, include) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile() && include(candidate)) files.push(candidate);
    }
  };
  walk(root);
  return files.sort();
}

export function discoverHistoryFiles({ home = os.homedir() } = {}) {
  return {
    claude: findFiles(path.join(home, ".claude", "projects"), (file) => file.endsWith(".jsonl")),
    kimi: findFiles(path.join(home, ".kimi-code", "sessions"), (file) => path.basename(file) === "wire.jsonl"),
    codex: findFiles(path.join(home, ".codex", "sessions"), (file) => file.endsWith(".jsonl")),
    antigravity: [],
  };
}
