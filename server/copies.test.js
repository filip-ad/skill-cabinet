import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { attachCopies } from "./scan.js";

function hash(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

test("identical markdown bodies are copies of each other", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-copies-"));
  try {
    const body = "---\nname: twin\ndescription: same\n---\n\nSame body.\n";
    const a = path.join(dir, "a.md");
    const b = path.join(dir, "b.md");
    fs.writeFileSync(a, body);
    fs.writeFileSync(b, body);
    const digest = hash(fs.readFileSync(a));
    const skills = [
      {
        id: "one",
        scopeLabel: ".agents",
        path: a,
        contentHash: digest,
        physicality: "physical",
      },
      {
        id: "two",
        scopeLabel: ".claude",
        path: b,
        contentHash: digest,
        physicality: "physical",
      },
    ];
    attachCopies(skills);
    assert.deepEqual(skills[0].copies, [
      { id: "two", scopeLabel: ".claude", path: b },
    ]);
    assert.deepEqual(skills[1].copies, [
      { id: "one", scopeLabel: ".agents", path: a },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a reference to identical content is not a copy", () => {
  const skills = [
    {
      id: "one",
      scopeLabel: ".agents",
      path: "/tmp/a",
      contentHash: hash("alpha"),
      physicality: "physical",
    },
    {
      id: "two",
      scopeLabel: ".claude",
      path: "/tmp/b",
      contentHash: hash("alpha"),
      physicality: "reference",
    },
  ];
  attachCopies(skills);
  assert.deepEqual(skills[0].copies, []);
  assert.deepEqual(skills[1].copies, []);
});

test("different bodies are not copies", () => {
  const skills = [
    {
      id: "one",
      scopeLabel: ".agents",
      path: "/tmp/a",
      contentHash: hash("alpha"),
      physicality: "physical",
    },
    {
      id: "two",
      scopeLabel: ".claude",
      path: "/tmp/b",
      contentHash: hash("beta"),
      physicality: "physical",
    },
  ];
  attachCopies(skills);
  assert.deepEqual(skills[0].copies, []);
  assert.deepEqual(skills[1].copies, []);
});
