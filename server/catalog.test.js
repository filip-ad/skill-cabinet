import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadCatalog, readRegisteredFile } from "./catalog.js";


function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
  const registry = path.join(root, "registry");
  const skill = path.join(root, "skill");
  fs.mkdirSync(registry);
  fs.mkdirSync(skill);
  fs.writeFileSync(path.join(skill, "SKILL.md"), "# Sample\n");
  const installation = {
    installation_id: "install-1",
    canonical_group_id: "group-1",
    skill_id: "sample",
    display_name: "sample",
    description: "Sample",
    location: path.join(skill, "SKILL.md"),
    real_location: path.join(skill, "SKILL.md"),
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
  fs.writeFileSync(path.join(registry, "INVENTORY.json"), JSON.stringify({
    schema_version: 1,
    counts: { installations: 1, canonical_groups: 1 },
    canonical_groups: [{ canonical_group_id: "group-1", installation_ids: ["install-1"] }],
    installations: [installation],
  }));
  fs.writeFileSync(path.join(registry, "SKILL_CURRENCY.json"), JSON.stringify({
    schema_version: 1,
    checked_at: "2026-09-07T12:00:00Z",
    targets: [{ name: "sample", target: installation.location, status: "current", installed: "one", latest: "one", action: "none" }],
  }));
  return { root, registry, skill, installation };
}

test("loads only governed export rows and joins exact currency targets", () => {
  const value = fixture();
  const catalog = loadCatalog({ registryRoot: value.registry });
  assert.equal(catalog.installations.length, 1);
  assert.equal(catalog.installations[0].currency.status, "current");
  fs.rmSync(value.root, { recursive: true });
});

test("creates a complete unverifiable currency row when no target matches", () => {
  const value = fixture();
  const file = path.join(value.registry, "SKILL_CURRENCY.json");
  const document = JSON.parse(fs.readFileSync(file));
  document.targets = [];
  fs.writeFileSync(file, JSON.stringify(document));

  const catalog = loadCatalog({ registryRoot: value.registry });

  assert.deepEqual(Object.keys(catalog.installations[0].currency).sort(), [
    "action", "installed", "latest", "mechanism", "name", "ownership",
    "status", "target", "upstream",
  ]);
  assert.equal(catalog.installations[0].currency.status, "unverifiable");
  fs.rmSync(value.root, { recursive: true });
});

test("rejects a catalog count that does not match the exported rows", () => {
  const value = fixture();
  const file = path.join(value.registry, "INVENTORY.json");
  const document = JSON.parse(fs.readFileSync(file));
  document.counts.installations = 2;
  fs.writeFileSync(file, JSON.stringify(document));
  assert.throws(() => loadCatalog({ registryRoot: value.registry }), /count does not match/);
  fs.rmSync(value.root, { recursive: true });
});

test("file preview stays inside the registered root after symlink resolution", () => {
  const value = fixture();
  const outside = path.join(value.root, "private.txt");
  fs.writeFileSync(outside, "private");
  fs.symlinkSync(outside, path.join(value.skill, "escape.txt"));
  assert.throws(
    () => readRegisteredFile(value.installation, "escape.txt"),
    /leaves the registered skill root/,
  );
  fs.rmSync(value.root, { recursive: true });
});

test("rejects local skill text that does not match its governed digest", () => {
  const value = fixture();
  fs.writeFileSync(path.join(value.skill, "SKILL.md"), "# Changed\n");
  assert.throws(
    () => readRegisteredFile(value.installation, "SKILL.md"),
    /does not match its governed digest/,
  );
  fs.rmSync(value.root, { recursive: true });
});
