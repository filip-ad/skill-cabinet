import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertDeletable,
  deleteEffect,
  deleteSkillDir,
} from "./scan.js";

function skillMarkdown() {
  return "---\nname: sample\ndescription: a sample skill\n---\n\nBody.\n";
}

test("deleteEffect names unlink, file, and folder", () => {
  assert.equal(
    deleteEffect({ link: true, path: "/tmp/link", linkTarget: "/tmp/real" })
      .action,
    "unlink",
  );
  assert.equal(
    deleteEffect({ file: true, path: "/tmp/note.md", link: false }).action,
    "delete-file",
  );
  assert.equal(deleteEffect({ path: "/tmp/folder" }).action, "delete-folder");
});

test("a dead shortcut unlinks and says the target is gone", () => {
  const effect = deleteEffect({
    link: true,
    path: "/tmp/dead",
    linkTarget: "/tmp/gone",
    physicality: "broken",
  });
  assert.equal(effect.action, "unlink");
  assert.equal(effect.note, "The target is already gone");
});

test("unlinking a symlink keeps the target folder", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-del-"));
  try {
    const cabinet = path.join(root, "cabinet");
    const realSkill = path.join(cabinet, "real-skill");
    const linkSkill = path.join(cabinet, "link-skill");
    fs.mkdirSync(realSkill, { recursive: true });
    fs.writeFileSync(path.join(realSkill, "SKILL.md"), skillMarkdown());
    fs.symlinkSync(realSkill, linkSkill);
    const roots = [{ root: cabinet }];
    const target = assertDeletable({ path: linkSkill }, roots);
    deleteSkillDir(target);
    assert.equal(fs.existsSync(linkSkill), false);
    assert.equal(fs.existsSync(path.join(realSkill, "SKILL.md")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("folder delete removes the skill directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-rm-"));
  try {
    const cabinet = path.join(root, "cabinet");
    const skill = path.join(cabinet, "doomed");
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, "SKILL.md"), skillMarkdown());
    deleteSkillDir(assertDeletable({ path: skill }, [{ root: cabinet }]));
    assert.equal(fs.existsSync(skill), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assertDeletable refuses a cabinet root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-root-"));
  try {
    fs.writeFileSync(path.join(root, "SKILL.md"), skillMarkdown());
    assert.throws(
      () => assertDeletable({ path: root }, [{ root }]),
      /cabinet root/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
