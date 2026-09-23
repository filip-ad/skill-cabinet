import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { recordUsage } from "./recorder.js";


const CLI = path.resolve("bin/skill-usage.js");

test("record mode warns but does not fail the calling task", () => {
  const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-recorder-missing-"));
  const result = spawnSync(
    process.execPath,
    [CLI, "--cli", "codex", "--path", "/missing/SKILL.md", "--session", "test-session"],
    {
      encoding: "utf8",
      env: { ...process.env, SKILL_REGISTRY_ROOT: registryRoot },
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stderr, /skill usage failed:/);
  fs.rmSync(registryRoot, { recursive: true });
});

test("record mode still rejects invalid invocation syntax", () => {
  const result = spawnSync(process.execPath, [CLI, "--cli", "codex"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("record mode repairs the default-style directory and existing log permissions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-recorder-private-"));
  const registryRoot = path.join(root, "registry");
  const skillRoot = path.join(root, "sample");
  const outputDirectory = path.join(root, "skill-cabinet");
  const outputPath = path.join(outputDirectory, "usage.jsonl");
  fs.mkdirSync(registryRoot);
  fs.mkdirSync(skillRoot);
  fs.mkdirSync(outputDirectory, { mode: 0o755 });
  fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "# Sample\n");
  fs.writeFileSync(outputPath, "", { mode: 0o644 });
  const installation = {
    installation_id: "install-1",
    canonical_group_id: "group-1",
    skill_id: "sample",
    display_name: "sample",
    description: "Sample",
    location: path.join(skillRoot, "SKILL.md"),
    real_location: path.join(skillRoot, "SKILL.md"),
    content_sha256: createHash("sha256").update("# Sample\n").digest("hex"),
    scope: "global",
    cli: "shared",
    repository: "",
    ownership: "local",
    governance: "managed",
    governance_owner: "owner/repo",
    tracking_issue: "",
    source: "agent-skills",
  };
  fs.writeFileSync(path.join(registryRoot, "INVENTORY.json"), JSON.stringify({
    schema_version: 1,
    counts: { installations: 1, canonical_groups: 1 },
    canonical_groups: [{ canonical_group_id: "group-1", installation_ids: ["install-1"] }],
    installations: [installation],
  }));
  fs.writeFileSync(path.join(registryRoot, "SKILL_CURRENCY.json"), JSON.stringify({
    schema_version: 1,
    checked_at: "2026-09-19T12:00:00Z",
    targets: [],
  }));

  recordUsage({
    cli: "codex",
    skillPath: installation.location,
    sessionId: "private-session",
    registryRoot,
    outputPath,
  });

  assert.equal(fs.statSync(outputDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  fs.rmSync(root, { recursive: true });
});
