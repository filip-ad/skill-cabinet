import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";

const HOME = os.homedir();

const SKIP_HOME_DOTDIRS = new Set([
  ".cache",
  ".local",
  ".npm",
  ".nvm",
  ".rustup",
  ".cargo",
  ".docker",
  ".mozilla",
  ".config",
  ".steam",
  ".var",
  ".wine",
  ".thumbnails",
  ".Trash",
  ".android",
  ".gradle",
  ".java",
]);

const SKIP_WALK = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cache",
  "upstream",
]);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function idFor(absPath) {
  return crypto.createHash("sha1").update(absPath).digest("hex").slice(0, 16);
}

const NAMED_SKILL_FILES = new Set(["skill.md", "SKILL.md"]);
const IGNORE_LOOSE_MD = new Set([
  "readme.md",
  "changelog.md",
  "license.md",
  "licence.md",
]);

function isSkillFileName(name) {
  if (NAMED_SKILL_FILES.has(name)) return true;
  if (!/\.md$/i.test(name)) return false;
  return !IGNORE_LOOSE_MD.has(name.toLowerCase());
}

function findSkillFile(dir) {
  for (const name of ["SKILL.md", "skill.md"]) {
    const p = path.join(dir, name);
    if (exists(p) && !isDir(p)) return p;
  }
  return null;
}

function readLinkTarget(p) {
  try {
    return fs.readlinkSync(p);
  } catch {
    return "";
  }
}

function describeInstall(p) {
  let link = false;
  let file = false;
  let linkTarget = "";
  try {
    const listed = fs.lstatSync(p);
    link = listed.isSymbolicLink();
    if (link) {
      linkTarget = readLinkTarget(p);
      try {
        file = fs.statSync(p).isFile();
      } catch {
        file = false;
      }
    } else {
      file = listed.isFile();
    }
  } catch {
    /* missing or unreadable */
  }
  return { link, file, linkTarget };
}

function contained(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) {
    return { data: {}, content: text, raw: "" };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, content: text, raw: "" };
  }
  const raw = text.slice(3, end).replace(/^\n/, "");
  let data = {};
  try {
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed;
    }
  } catch {
    data = { _parseError: "YAML frontmatter could not be parsed" };
  }
  const content = text.slice(end + 4).replace(/^\n/, "");
  return { data, content, raw };
}

function kindFor(root) {
  return root.kind;
}

export function discoverRoots() {
  const roots = [];
  const seen = new Set();

  const add = (scopeId, scopeLabel, root, kind, recursive = false) => {
    if (!exists(root) || !isDir(root)) return;
    const resolved = real(root);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push({ scopeId, scopeLabel, root: resolved, kind, recursive });
  };

  let homeEntries = [];
  try {
    homeEntries = fs.readdirSync(HOME, { withFileTypes: true });
  } catch {
    homeEntries = [];
  }

  for (const entry of homeEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!entry.name.startsWith(".")) continue;
    if (SKIP_HOME_DOTDIRS.has(entry.name)) continue;

    const base = path.join(HOME, entry.name);
    const scopeId = entry.name.slice(1);

    for (const folder of ["skills", "skill"]) {
      add(scopeId, entry.name, path.join(base, folder), "user", false);
    }

    if (entry.name === ".cursor") {
      add(
        "cursor-builtin",
        ".cursor/skills-cursor",
        path.join(base, "skills-cursor"),
        "builtin",
        false,
      );
      add(
        "cursor-plugins",
        ".cursor/plugins",
        path.join(base, "plugins"),
        "plugin",
        true,
      );
    }
  }

  add(
    "gemini",
    ".gemini/antigravity",
    path.join(HOME, ".gemini/antigravity/skills"),
    "user",
    false,
  );
  add(
    "gemini",
    ".gemini/antigravity (global)",
    path.join(HOME, ".gemini/antigravity/global_skills"),
    "user",
    false,
  );

  return roots;
}

function collectDirectSkills(root, list) {
  let entries;
  try {
    entries = fs.readdirSync(root.root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_WALK.has(entry.name)) continue;
    const abs = path.resolve(path.join(root.root, entry.name));
    const install = describeInstall(abs);
    if (isDir(abs)) {
      const skillMd = findSkillFile(abs);
      if (skillMd) {
        list.push({ dir: abs, skillMd, root, ...install, file: false });
      }
      continue;
    }
    if (install.file && isSkillFileName(entry.name)) {
      list.push({
        dir: abs,
        skillMd: abs,
        root,
        ...install,
        file: true,
      });
    }
  }
}

function walkSkillContainers(dir, root, list, depth = 0) {
  if (depth > 14) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const base = path.basename(dir);
  if (base === "skills" || base === "skill") {
    collectDirectSkills({ ...root, root: dir }, list);
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIP_WALK.has(entry.name)) continue;
    walkSkillContainers(path.join(dir, entry.name), root, list, depth + 1);
  }
}

function dirSizeAndFiles(dir) {
  try {
    const followed = fs.statSync(dir);
    if (followed.isFile()) {
      return {
        files: [
          {
            path: path.basename(dir),
            size: followed.size,
            mtime: followed.mtimeMs,
          },
        ],
        bytes: followed.size,
      };
    }
  } catch {
    /* walk as a directory when we can */
  }
  const files = [];
  let bytes = 0;
  const walk = (current, rel, depth) => {
    if (depth > 8 || files.length > 250) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_WALK.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (entry.isDirectory() || (entry.isSymbolicLink() && isDir(abs))) {
          walk(abs, nextRel, depth + 1);
        }
      } else if (entry.isFile()) {
        let size = 0;
        let mtime = 0;
        try {
          const st = fs.statSync(abs);
          size = st.size;
          mtime = st.mtimeMs;
          bytes += size;
        } catch {
          /* ignore */
        }
        files.push({ path: nextRel, size, mtime });
      }
    }
  };
  walk(dir, "", 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, bytes };
}

function summarizeSkill(item) {
  const { dir, skillMd, root } = item;
  let text = "";
  let mtime = 0;
  let size = 0;
  try {
    const st = fs.statSync(skillMd);
    mtime = st.mtimeMs;
    size = st.size;
    text = fs.readFileSync(skillMd, "utf8");
  } catch {
    return null;
  }
  const { data } = parseFrontmatter(text);
  const base = path.basename(dir);
  const slug = item.file ? base.replace(/\.md$/i, "") : base;
  const name =
    (typeof data.name === "string" && data.name) ||
    (typeof data.displayName === "string" && data.displayName) ||
    slug;
  const description =
    typeof data.description === "string" ? data.description : "";

  return {
    id: idFor(dir),
    name,
    slug,
    description,
    frontmatter: data,
    scopeId: root.scopeId,
    scopeLabel: root.scopeLabel,
    kind: kindFor(root),
    path: dir,
    skillFile: skillMd,
    skillRel: path.basename(skillMd),
    file: Boolean(item.file),
    link: Boolean(item.link),
    linkTarget: item.linkTarget || "",
    mtime,
    skillSize: size,
  };
}

export function scanSkills() {
  const roots = discoverRoots();
  const found = [];
  for (const root of roots) {
    if (root.recursive) {
      walkSkillContainers(root.root, root, found);
    } else {
      collectDirectSkills(root, found);
    }
  }

  const byPath = new Map();
  for (const item of found) {
    byPath.set(item.dir, item);
  }

  const skills = [];
  const byId = new Map();
  for (const item of byPath.values()) {
    const summary = summarizeSkill(item);
    if (!summary) continue;
    skills.push(summary);
    byId.set(summary.id, summary);
  }

  skills.sort((a, b) => {
    const scope = a.scopeLabel.localeCompare(b.scopeLabel);
    if (scope !== 0) return scope;
    return a.name.localeCompare(b.name);
  });

  return { roots, skills, byId };
}

export function readSkill(summary) {
  const text = fs.readFileSync(summary.skillFile, "utf8");
  const { data, content, raw } = parseFrontmatter(text);
  const { files, bytes } = dirSizeAndFiles(summary.path);
  return {
    ...summary,
    frontmatter: data,
    frontmatterRaw: raw,
    body: content,
    source: text,
    files,
    bytes,
  };
}

export function readSkillFile(summary, relPath) {
  if (summary.file) {
    const abs = real(summary.skillFile);
    const st = fs.statSync(abs);
    if (st.size > 1_500_000) {
      const err = new Error("File too large to preview");
      err.status = 413;
      throw err;
    }
    const buf = fs.readFileSync(abs);
    return {
      path: path.basename(summary.skillFile),
      size: st.size,
      binary: false,
      content: buf.toString("utf8"),
    };
  }
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = real(path.join(summary.path, normalized));
  const root = real(summary.path);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    const err = new Error("Path escapes skill directory");
    err.status = 400;
    throw err;
  }
  if (!exists(abs) || isDir(abs)) {
    const err = new Error("File not found");
    err.status = 404;
    throw err;
  }
  const st = fs.statSync(abs);
  if (st.size > 1_500_000) {
    const err = new Error("File too large to preview");
    err.status = 413;
    throw err;
  }
  const buf = fs.readFileSync(abs);
  const looksText =
    !buf.includes(0) &&
    /\.(md|txt|ya?ml|json|js|mjs|cjs|ts|tsx|jsx|py|sh|html|css|svg|toml|xml|csv|rst)$/i.test(
      abs,
    );
  return {
    path: path.relative(root, abs),
    size: st.size,
    binary: !looksText,
    content: looksText ? buf.toString("utf8") : null,
  };
}

export function assertDeletable(summary, roots) {
  const target = path.resolve(summary.path);
  const ok = roots.some((r) => contained(target, r.root) && path.resolve(r.root) !== target);
  if (!ok || target === HOME) {
    const err = new Error(
      ok
        ? "Refusing to delete a cabinet root"
        : "Skill is outside known cabinet roots",
    );
    err.status = 403;
    throw err;
  }
  const install = describeInstall(target);
  const isFolderSkill = isDir(target) && findSkillFile(target);
  const isFileSkill = install.file && isSkillFileName(path.basename(target));
  if (!isFolderSkill && !isFileSkill) {
    const err = new Error("Not a skill path");
    err.status = 400;
    throw err;
  }
  return target;
}

export function deleteSkillDir(target) {
  const st = fs.lstatSync(target);
  if (st.isSymbolicLink() || st.isFile()) {
    fs.unlinkSync(target);
    return;
  }
  fs.rmSync(target, { recursive: true, force: false });
}
