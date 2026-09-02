import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { scanRoots } from "./scan.js";

const BODY = "---\nname: sample\ndescription: a sample skill\n---\n\nBody.\n";
const ASSET = "console.log('companion script');\n";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-census-"));
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

function folderBytes(skillDir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(skillDir)) {
    bytes += fs.statSync(path.join(skillDir, entry)).size;
  }
  return bytes;
}

test("the census separates physical, references, and broken", () => {
  const dir = tempDir();
  try {
    const skillsDir = path.join(dir, "skills");
    const linksDir = path.join(dir, "links");
    writeSkill(
      skillsDir,
      "deep-research",
      "---\nname: deep-research\ndescription: unique\n---\n\nUnique body.\n",
    );
    writeSkill(skillsDir, "twin-a");
    writeSkill(skillsDir, "twin-b");
    fs.mkdirSync(linksDir, { recursive: true });
    fs.symlinkSync(
      path.join(skillsDir, "deep-research"),
      path.join(linksDir, "deep-research"),
    );
    fs.symlinkSync("./nowhere", path.join(linksDir, "dead"));
    const result = scanRoots([root(skillsDir, "skills"), root(linksDir, "links")]);
    assert.deepEqual(result.census, {
      total: 5,
      physical: 3,
      unique: 2,
      duplicateCopies: 2,
      duplicateBytes: 2 * Buffer.byteLength(BODY, "utf8"),
      references: 1,
      broken: 1,
      duplicates: 2,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("duplicateBytes counts the whole folder of each duplicate", () => {
  const dir = tempDir();
  try {
    const skillsDir = path.join(dir, "skills");
    writeSkill(skillsDir, "twin-a");
    fs.writeFileSync(
      path.join(skillsDir, "twin-a", "run.sh"),
      ASSET,
    );
    writeSkill(skillsDir, "twin-b");
    fs.writeFileSync(
      path.join(skillsDir, "twin-b", "run.sh"),
      ASSET,
    );
    const result = scanRoots([root(skillsDir, "skills")]);
    const expected =
      folderBytes(path.join(skillsDir, "twin-a")) +
      folderBytes(path.join(skillsDir, "twin-b"));
    assert.equal(result.census.duplicateCopies, 2);
    assert.equal(result.census.duplicateBytes, expected);
    assert.ok(result.census.duplicateBytes > 2 * BODY.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("references and broken cards add no bytes to the census", () => {
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
    fs.symlinkSync("./nowhere", path.join(linksDir, "dead"));
    const result = scanRoots([root(skillsDir, "skills"), root(linksDir, "links")]);
    assert.equal(result.census.duplicateCopies, 0);
    assert.equal(result.census.duplicateBytes, 0);
    assert.equal(result.census.references, 1);
    assert.equal(result.census.broken, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
