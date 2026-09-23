import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { createApp } from "./index.js";
import { UsageStore } from "./usage.js";


async function setup({ allowedHosts } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-server-"));
  const skillRoot = path.join(root, "sample");
  fs.mkdirSync(skillRoot);
  fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "# Sample\n");
  const installation = {
    installation_id: "install-1",
    canonical_group_id: "group-1",
    skill_id: "sample",
    display_name: "sample",
    description: "Sample skill",
    location: path.join(skillRoot, "SKILL.md"),
    real_location: path.join(skillRoot, "SKILL.md"),
    content_sha256: createHash("sha256").update("# Sample\n").digest("hex"),
    scope: "global",
    cli: "shared",
    repository: "",
    ownership: "local",
    governance: "managed",
    governance_owner: "owner/repo",
    source: "agent-skills",
    currency: { status: "current", installed: "one", latest: "one" },
  };
  const inventory = { schema_version: 1, counts: { installations: 1, canonical_groups: 1 }, installations: [installation] };
  const catalog = {
    inventory,
    currency: { checked_at: "2026-09-07T12:00:00Z" },
    installations: [installation],
    byId: new Map([[installation.installation_id, installation]]),
    groupsById: new Map([["group-1", { canonical_group_id: "group-1" }]]),
    loadedAt: "2026-09-07T12:01:00Z",
  };
  const usageStore = new UsageStore({ dbPath: path.join(root, "usage.sqlite"), inventory });
  const app = createApp({ catalog, usageStore, allowedHosts });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = server.address().port;
  return { root, skillRoot, usageStore, server, base: `http://127.0.0.1:${port}` };
}

test("serves governed GET data with restrictive browser headers", async () => {
  const value = await setup();
  const response = await fetch(`${value.base}/api/catalog`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.equal(body.skills.length, 1);
  value.server.close();
  value.usageStore.close();
  fs.rmSync(value.root, { recursive: true });
});

test("rejects every non-GET API request and has no management command", async () => {
  const value = await setup();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await fetch(`${value.base}/api/catalog`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
  }
  value.server.close();
  value.usageStore.close();
  fs.rmSync(value.root, { recursive: true });
});

test("rejects a non-local Host header", async () => {
  const value = await setup();
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request(`${value.base}/api/health`, { headers: { Host: "evil.example" } }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 403);
  } finally {
    value.server.close();
    value.usageStore.close();
    fs.rmSync(value.root, { recursive: true });
  }
});

test("accepts only an explicitly configured Tailnet host", async () => {
  const value = await setup({ allowedHosts: new Set(["127.0.0.1", "skills.example.ts.net"]) });
  try {
    const request = (host) => new Promise((resolve, reject) => {
      const call = http.request(`${value.base}/api/health`, { headers: { Host: host } }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      call.on("error", reject);
      call.end();
    });
    assert.equal(await request("skills.example.ts.net:8445"), 200);
    assert.equal(await request("other.example.ts.net:8445"), 403);
  } finally {
    value.server.close();
    value.usageStore.close();
    fs.rmSync(value.root, { recursive: true });
  }
});

test("returns skill content only through the registered installation", async () => {
  const value = await setup();
  const response = await fetch(`${value.base}/api/skills/install-1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.manuscript.content, "# Sample\n");
  assert.equal(body.installation.installation_id, "install-1");
  value.server.close();
  value.usageStore.close();
  fs.rmSync(value.root, { recursive: true });
});

test("does not serve local skill text after its governed digest changes", async () => {
  const value = await setup();
  fs.writeFileSync(path.join(value.skillRoot, "SKILL.md"), "# Changed\n");
  const response = await fetch(`${value.base}/api/skills/install-1`);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Registered skill text does not match its governed digest" });
  value.server.close();
  value.usageStore.close();
  fs.rmSync(value.root, { recursive: true });
});
