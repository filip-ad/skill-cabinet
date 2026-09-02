import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertDeletable,
  deleteSkillDir,
  readSkill,
  scanRoots,
} from "./scan.js";

const BODY = "---\nname: sample\ndescription: a sample skill\n---\n\nBody.\n";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-class-"));
}

function writeSkill(dir, name, text = BODY) {
  const skill = path.join(dir, name);
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), text);
  return skill;
}

function root(dir, scopeId) {
  return { scopeId, scopeLabel: scopeId, root: dir, kind: "user", recursive: false };
}

test("a symlink to a cataloged skill is a reference, not a duplicate", () => {
  const dir = tempDir();
  try {
    const skillsDir = path.join(dir, "skills");
    const linksDir = path.join(dir, "links");
    writeSkill(skillsDir, "deep-research");
    fs.mkdirSync(linksDir, { recursive: true });
    fs.symlinkSync(
      path.join(skillsDir, "deep-research"),
      path.join(linksDir, "deep-research"),
    );
    const result = scanRoots([root(skillsDir, "skills"), root(linksDir, "links")]);
    const physical = result.skills.find(
      (s) => s.slug === "deep-research" && s.physicality === "physical",
    );
    const reference = result.skills.find((s) => s.physicality === "reference");
    assert.ok(physical, "physical card exists");
    assert.ok(reference, "reference card exists");
    assert.equal(reference.refSkillId, physical.id);
    assert.equal(
      reference.refTarget,
      fs.realpathSync(path.join(skillsDir, "deep-research")),
    );
    assert.deepEqual(physical.copies, []);
    assert.deepEqual(reference.copies, []);
    assert.equal(result.census.unique, 1);
    assert.equal(result.census.duplicates, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a symlink chain resolves to the final target", () => {
  const dir = tempDir();
  try {
    const skillsDir = path.join(dir, "skills");
    const linksDir = path.join(dir, "links");
    writeSkill(skillsDir, "deep-research");
    fs.mkdirSync(linksDir, { recursive: true });
    fs.symlinkSync(
      path.join(skillsDir, "deep-research"),
      path.join(linksDir, "deep-research"),
    );
    fs.symlinkSync(
      path.join(linksDir, "deep-research"),
      path.join(linksDir, "chain"),
    );
    const result = scanRoots([root(skillsDir, "skills"), root(linksDir, "links")]);
    const chain = result.skills.find((s) => s.slug === "chain");
    assert.equal(chain.physicality, "reference");
    assert.equal(chain.refTarget, fs.realpathSync(path.join(skillsDir, "deep-research")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("byte-identical physical skills remain copies", () => {
  const dir = tempDir();
  try {
    const skillsDir = path.join(dir, "skills");
    writeSkill(skillsDir, "twin-a");
    writeSkill(skillsDir, "twin-b");
    const result = scanRoots([root(skillsDir, "skills")]);
    const a = result.skills.find((s) => s.slug === "twin-a");
    const b = result.skills.find((s) => s.slug === "twin-b");
    assert.deepEqual(
      a.copies.map((c) => c.id),
      [b.id],
    );
    assert.deepEqual(
      b.copies.map((c) => c.id),
      [a.id],
    );
    assert.equal(result.census.duplicates, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a dead shortcut becomes a broken card that can be unlinked", () => {
  const dir = tempDir();
  try {
    const skillsDir = path.join(dir, "skills");
    const linksDir = path.join(dir, "links");
    writeSkill(skillsDir, "deep-research");
    fs.mkdirSync(linksDir, { recursive: true });
    fs.symlinkSync("./nowhere", path.join(linksDir, "dead"));
    const result = scanRoots([root(skillsDir, "skills"), root(linksDir, "links")]);
    const dead = result.skills.find((s) => s.slug === "dead");
    assert.ok(dead, "broken card exists");
    assert.equal(dead.physicality, "broken");
    assert.equal(dead.link, true);
    assert.equal(dead.contentHash, null);
    assert.equal(result.census.total, 2);
    assert.equal(result.census.unique, 1);
    assert.equal(result.census.duplicates, 0);

    const detail = readSkill(dead);
    assert.equal(detail.body, "");
    assert.deepEqual(detail.files, []);
    assert.equal(detail.bytes, 0);

    const roots = result.roots;
    const target = assertDeletable(dead, roots);
    deleteSkillDir(target);
    assert.equal(fs.existsSync(path.join(linksDir, "dead")), false);
    assert.equal(
      fs.existsSync(path.join(skillsDir, "deep-research", "SKILL.md")),
      true,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a dead file shortcut is also broken", () => {
  const dir = tempDir();
  try {
    const linksDir = path.join(dir, "links");
    fs.mkdirSync(linksDir, { recursive: true });
    fs.symlinkSync("./missing.md", path.join(linksDir, "note.md"));
    const result = scanRoots([root(linksDir, "links")]);
    const dead = result.skills.find((s) => s.slug === "note");
    assert.ok(dead, "broken card exists");
    assert.equal(dead.physicality, "broken");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a reference to a skill outside the cabinet has no refSkillId", () => {
  const dir = tempDir();
  try {
    const outside = path.join(dir, "outside");
    const linksDir = path.join(dir, "links");
    writeSkill(outside, "my-skill");
    fs.mkdirSync(linksDir, { recursive: true });
    fs.symlinkSync(outside + "/my-skill", path.join(linksDir, "my-skill"));
    const result = scanRoots([root(linksDir, "links")]);
    const reference = result.skills.find((s) => s.physicality === "reference");
    assert.ok(reference, "reference card exists");
    assert.equal(reference.refSkillId, "");
    assert.equal(reference.refTarget, fs.realpathSync(path.join(outside, "my-skill")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
