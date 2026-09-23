import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverHistoryFiles,
  normalizeEvent,
  parseAntigravityRecords,
  parseClaudeRecords,
  parseCodexRecords,
  parseKimiRecords,
  UsageStore,
} from "./usage.js";


const inventory = {
  installations: [
    { installation_id: "global", canonical_group_id: "g1", skill_id: "sample", display_name: "sample", location: "~/.agents/skills/sample/SKILL.md", real_location: "~/.agents/skills/sample/SKILL.md", scope: "global", cli: "shared", repository: "" },
    { installation_id: "repo", canonical_group_id: "g2", skill_id: "sample", display_name: "sample", location: "~/dev/repo/.agents/skills/sample/SKILL.md", real_location: "~/dev/repo/.agents/skills/sample/SKILL.md", scope: "repo-local", cli: "repository", repository: "~/dev/repo" },
  ],
};

function event(overrides = {}) {
  return {
    source_id: "one",
    occurred_at: "2026-09-07T12:00:00Z",
    cli: "claude",
    session_id: "secret-session-id",
    skill_path: "~/.agents/skills/sample/SKILL.md",
    parser_version: "test-1",
    occurrence_evidence: "exact",
    ...overrides,
  };
}

test("keeps occurrence proof separate from installation identity", () => {
  const ambiguousInventory = {
    installations: [
      inventory.installations[0],
      { ...inventory.installations[0], installation_id: "other", location: "~/other/sample/SKILL.md" },
    ],
  };
  const ambiguous = normalizeEvent(event({ skill_path: undefined, skill_name: "sample" }), ambiguousInventory);
  assert.equal(ambiguous.occurrence_evidence, "exact");
  assert.equal(ambiguous.identity_resolution, "ambiguous");
  assert.equal(ambiguous.installation_id, null);
});

test("stores only allowlisted event fields and hashes the session", () => {
  const normalized = normalizeEvent(event(), inventory);
  assert.equal(normalized.identity_resolution, "resolved");
  assert.equal(normalized.installation_id, "global");
  assert.equal(normalized.session_id, undefined);
  assert.notEqual(normalized.session_hash, "secret-session-id");
  assert.throws(() => normalizeEvent(event({ prompt: "private" }), inventory), /forbidden field: prompt/);
});

test("an exact lexical path wins over other installs that share its real file", () => {
  const sharedInventory = {
    installations: [
      inventory.installations[0],
      { ...inventory.installations[0], installation_id: "claude", location: "~/.claude/skills/sample/SKILL.md", real_location: "~/.agents/skills/sample/SKILL.md", cli: "claude" },
    ],
  };
  const normalized = normalizeEvent(event(), sharedInventory);
  assert.equal(normalized.identity_resolution, "resolved");
  assert.equal(normalized.installation_id, "global");
});

test("a matching CLI install wins over a shared install for a name-only call", () => {
  const cliInventory = {
    installations: [
      inventory.installations[0],
      { ...inventory.installations[0], installation_id: "claude", cli: "claude", location: "~/.claude/skills/sample/SKILL.md" },
    ],
  };
  const normalized = normalizeEvent(event({ skill_path: undefined, skill_name: "sample" }), cliInventory);
  assert.equal(normalized.identity_resolution, "resolved");
  assert.equal(normalized.installation_id, "claude");
});

test("a shared runtime install wins over its canonical source for a name-only call", () => {
  const runtimeInventory = {
    installations: [
      inventory.installations[0],
      { ...inventory.installations[0], installation_id: "canonical", cli: "all", scope: "canonical", location: "~/dev/agent-skills/skills/sample/SKILL.md" },
    ],
  };
  const normalized = normalizeEvent(event({ skill_path: undefined, skill_name: "sample", cli: "codex" }), runtimeInventory);
  assert.equal(normalized.identity_resolution, "resolved");
  assert.equal(normalized.installation_id, "global");
});

test("a matching repository install wins over a global install for a name-only call", () => {
  const normalized = normalizeEvent(event({ skill_path: undefined, skill_name: "sample", repository: "~/dev/repo" }), inventory);
  assert.equal(normalized.identity_resolution, "resolved");
  assert.equal(normalized.installation_id, "repo");
});

test("a name-only call without repository context stays ambiguous across scopes", () => {
  const normalized = normalizeEvent(
    event({ skill_path: undefined, skill_name: "sample", repository: undefined }),
    inventory,
  );
  assert.equal(normalized.identity_resolution, "ambiguous");
  assert.equal(normalized.installation_id, null);
});

test("a repository-local call stays unresolved until repository context is observed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-reindex-context-"));
  const repoOnly = { installations: [inventory.installations[1]] };
  const store = new UsageStore({ dbPath: path.join(root, "usage.sqlite"), inventory: repoOnly });
  store.importEvents([event({
    skill_path: undefined,
    skill_name: "sample",
    repository: undefined,
  })], "fixture");
  assert.equal(store.forInstallation("repo").invocations, 0);
  assert.equal(store.aggregates().by_identity_resolution[0].key, "unresolved");

  store.inventory = {
    installations: [
      inventory.installations[1],
      {
        ...inventory.installations[1],
        installation_id: "repo-two",
        canonical_group_id: "g3",
        location: "~/dev/other/.agents/skills/sample/SKILL.md",
        real_location: "~/dev/other/.agents/skills/sample/SKILL.md",
        repository: "~/dev/other",
      },
    ],
  };
  store.reindex();

  assert.equal(store.forInstallation("repo").invocations, 0);
  assert.equal(store.aggregates().by_identity_resolution[0].key, "ambiguous");
  store.close();
  fs.rmSync(root, { recursive: true });
});

test("imports independently, deduplicates, and keeps unassigned exact calls in CLI totals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-usage-"));
  const store = new UsageStore({ dbPath: path.join(root, "usage.sqlite"), inventory });
  const result = store.importEvents([
    event(),
    event(),
    event({ source_id: "two", skill_path: undefined, skill_name: "unknown" }),
    event({ source_id: "bad", prompt: "private" }),
  ], "fixture");
  assert.deepEqual({ imported: result.imported, duplicates: result.duplicates, errors: result.errors.length }, { imported: 2, duplicates: 1, errors: 1 });
  const totals = store.aggregates();
  assert.equal(totals.summary.invocations, 2);
  assert.equal(totals.summary.unassigned_exact, 1);
  assert.equal(totals.by_cli[0].invocations, 2);
  assert.equal(totals.by_skill[0].invocations, 1);
  store.close();
  fs.rmSync(root, { recursive: true });
});

test("recovers a corrupt rebuildable database without losing the corrupt evidence file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-corrupt-"));
  const dbPath = path.join(root, "usage.sqlite");
  fs.writeFileSync(dbPath, "not sqlite");
  const store = new UsageStore({ dbPath, inventory });
  assert.equal(store.recovered, true);
  assert.equal(fs.existsSync(store.recoveryPath), true);
  store.close();
  fs.rmSync(root, { recursive: true });
});

test("keeps the usage directory and database private", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-private-"));
  const directory = path.join(root, "private");
  const dbPath = path.join(directory, "usage.sqlite");
  const store = new UsageStore({ dbPath, inventory });
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(dbPath).mode & 0o777, 0o600);
  store.close();
  fs.rmSync(root, { recursive: true });
});

test("provider adapters classify supported history without reading private content", () => {
  const claude = parseClaudeRecords([{ timestamp: "2026-09-07T12:00:00Z", sessionId: "s", cwd: "/repo", message: { content: [{ type: "tool_use", name: "Skill", id: "c1", input: { skill: "sample", prompt: "not copied" } }] } }]);
  const kimi = parseKimiRecords([{ type: "context.append_loop_event", time: "2026-09-07T12:00:00Z", event: { type: "tool.call", name: "Skill", toolCallId: "k1", args: { skill: "sample", raw_command: "not copied" } } }], { filePath: "/history/kimi.jsonl" });
  const codex = parseCodexRecords([
    { type: "session_meta", payload: { cwd: "/repo" } },
    { type: "event_msg", timestamp: "2026-09-07T12:00:00Z", payload: { type: "agent_message", message: "I am using the sample skill because it matches." } },
  ], { filePath: "/history/codex.jsonl" });
  assert.equal(claude[0].occurrence_evidence, "exact");
  assert.equal(kimi[0].occurrence_evidence, "exact");
  assert.equal(codex[0].occurrence_evidence, "inferred");
  assert.equal(kimi[0].session_id, "/history/kimi.jsonl");
  assert.equal(codex[0].repository, "/repo");
  assert.equal(parseCodexRecords([{ type: "event_msg", timestamp: "2026-09-07T12:00:00Z", payload: { type: "agent_message", message: "I'm using the `code_review` skill." } }])[0].skill_name, "code_review");
  assert.equal(parseCodexRecords([{ type: "event_msg", timestamp: "2026-09-07T12:00:00Z", payload: { type: "agent_message", message: "I will use the plugin.tool skill." } }])[0].skill_name, "plugin.tool");
  assert.equal(parseCodexRecords([{ type: "event_msg", timestamp: "2026-09-07T12:00:00Z", payload: { type: "agent_message", message: "Do not use the private skill." } }]).length, 0);
  assert.equal(parseAntigravityRecords([{ tool: "read" }]).length, 0);
  assert.equal(JSON.stringify([...claude, ...kimi]).includes("not copied"), false);
});

test("discovers only supported history files", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-history-"));
  const files = [
    path.join(home, ".claude", "projects", "repo", "one.jsonl"),
    path.join(home, ".kimi-code", "sessions", "repo", "agents", "main", "wire.jsonl"),
    path.join(home, ".kimi-code", "sessions", "repo", "other.jsonl"),
    path.join(home, ".codex", "sessions", "2026", "two.jsonl"),
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{}\n");
  }
  const found = discoverHistoryFiles({ home });
  assert.deepEqual(found.claude, [files[0]]);
  assert.deepEqual(found.kimi, [files[1]]);
  assert.deepEqual(found.codex, [files[3]]);
  assert.deepEqual(found.antigravity, []);
  fs.rmSync(home, { recursive: true });
});

test("JSONL import cursors read only complete new records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-cursor-"));
  const file = path.join(root, "claude.jsonl");
  const makeRecord = (id) => JSON.stringify({ timestamp: "2026-09-07T12:00:00Z", sessionId: "s", cwd: "/repo", message: { content: [{ type: "tool_use", name: "Skill", id, input: { skill: "sample" } }] } });
  fs.writeFileSync(file, `${makeRecord("one")}\n`);
  const store = new UsageStore({ dbPath: path.join(root, "usage.sqlite"), inventory });
  assert.equal(store.importJsonlFile(file, "claude", parseClaudeRecords).imported, 1);
  assert.equal(store.importJsonlFile(file, "claude", parseClaudeRecords).imported, 0);
  fs.appendFileSync(file, `${makeRecord("two")}\n`);
  assert.equal(store.importJsonlFile(file, "claude", parseClaudeRecords).imported, 1);
  assert.equal(store.aggregates().summary.invocations, 2);
  store.close();
  fs.rmSync(root, { recursive: true });
});

test("Codex incremental imports retain session repository context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-codex-cursor-"));
  const file = path.join(root, "codex.jsonl");
  const metadata = JSON.stringify({ type: "session_meta", payload: { cwd: path.join(os.homedir(), "dev", "repo") } });
  const message = (id, timestamp) => JSON.stringify({
    id,
    type: "event_msg",
    timestamp,
    payload: { type: "agent_message", message: "I am using the sample skill because it matches." },
  });
  fs.writeFileSync(file, `${metadata}\n${message("one", "2026-09-07T12:00:00Z")}\n`);
  const store = new UsageStore({ dbPath: path.join(root, "usage.sqlite"), inventory });
  assert.equal(store.importJsonlFile(file, "codex", parseCodexRecords).imported, 1);
  fs.appendFileSync(file, `${message("two", "2026-09-07T12:01:00Z")}\n`);
  assert.equal(store.importJsonlFile(file, "codex", parseCodexRecords).imported, 1);
  assert.equal(store.forInstallation("repo").invocations, 2);
  assert.equal(store.forInstallation("global").invocations, 0);
  store.close();
  fs.rmSync(root, { recursive: true });
});
