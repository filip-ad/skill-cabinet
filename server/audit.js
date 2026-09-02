/**
 * Static skill-body audit.
 * Rule ideas adapted from Adaptive Skills (MIT):
 * https://github.com/wangsoft/Adaptive-Skills
 */
import fs from "node:fs";
import path from "node:path";

const SEVERITY_ORDER = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SKIP_WALK = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cache",
  "upstream",
  "__pycache__",
  ".venv",
  "venv",
]);

const COMPANION_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".py",
  ".js",
  ".mjs",
  ".cjs",
]);

const MAX_FILE_BYTES = 256_000;
const MAX_TREE_BYTES = 512_000;
const MAX_DEPTH = 4;
const MAX_FILES = 12;

const SHELL_FENCE_LANGUAGES = new Set([
  "",
  "sh",
  "shell",
  "bash",
  "zsh",
  "fish",
  "console",
  "terminal",
]);

const DENYLIST_PATTERN =
  /(?:\bdo\s+not\b|\bdon't\b|\bnever\b|\bmust\s+not\b|\bavoid\b|\bforbidden\b|\bdenylist\b|\bblocklist\b)/i;

const SHELLISH_LINE =
  /^(?:[-*+]\s+)?(?:[$>]\s*)?(?:sudo\s+)?(?:curl|wget|rm|git|bash|sh|zsh|fish|python(?:3)?|node|npm|npx|pnpm|yarn|eval|exec)\b/i;

const IMPERATIVE_LINE =
  /^(?:[-*+]\s+)?(?:read|open|copy|upload|download|delete|remove|write|modify|send|execute|run)\b/i;

const PROMPT_COMMAND = /^(?:[-*+]\s+)?(?:ignore|disregard)\b/i;

const RULES = [
  {
    severity: "critical",
    rule: "shell.remote-pipe",
    pattern:
      /(?:curl|wget)\b[^\n|]{0,500}\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/gi,
    message: "Downloads are piped directly to a shell",
  },
  {
    severity: "high",
    rule: "filesystem.broad-delete",
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(?:\/|~|\$HOME)(?:\s|$)/gi,
    message: "Command may recursively delete a broad filesystem root",
  },
  {
    severity: "high",
    rule: "credentials.sensitive-path",
    pattern:
      /(?:\.ssh\/(?:id_|config)|\.aws\/credentials|\.config\/gcloud|login\.keychain)/gi,
    message: "References a sensitive credential location",
  },
  {
    severity: "high",
    rule: "execution.obfuscated",
    pattern: /(?:eval|exec)\s*\([^\n]{0,200}(?:base64|b64decode)/gi,
    message: "Executes obfuscated or decoded content",
  },
  {
    severity: "medium",
    rule: "prompt.override",
    pattern:
      /(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|system)\s+instructions/gi,
    message: "Contains an instruction-override phrase",
  },
  {
    severity: "medium",
    rule: "git.global-config",
    pattern: /git\s+config\s+--global/gi,
    message: "Modifies global Git configuration",
  },
  {
    severity: "low",
    rule: "network.download",
    pattern: /\b(?:curl|wget)\b/gi,
    message: "Uses a network download command",
  },
];

const SUBSUMED = {
  "network.download": new Set(["shell.remote-pipe"]),
};

function maxSeverity(values) {
  let best = "none";
  for (const value of values) {
    if (SEVERITY_ORDER[value] > SEVERITY_ORDER[best]) best = value;
  }
  return best;
}

function isDocument(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (ext === ".md" || ext === ".txt" || ext === ".rst") return true;
  return /(^|\/)skill\.md$/i.test(rel.replace(/\\/g, "/"));
}

function newlineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineNumberAt(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= index) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function fenceLanguage(line) {
  const match = line.match(/^\s*```\s*([\w+-]*)/);
  return match ? match[1].toLowerCase() : null;
}

function lineContext(rel, lines, lineIndex, rule, inShellFence) {
  const line = lines[lineIndex] || "";
  if (DENYLIST_PATTERN.test(line)) return "denylist";
  const previous = [...lines.slice(Math.max(0, lineIndex - 4), lineIndex)]
    .reverse()
    .find((item) => item.trim());
  if (
    previous &&
    DENYLIST_PATTERN.test(previous) &&
    (previous.trim().endsWith(":") || previous.trim().startsWith("#"))
  ) {
    return "denylist";
  }

  const stripped = line.trim();
  if (isDocument(rel)) {
    if (inShellFence) return "command_invocation";
    if (SHELLISH_LINE.test(stripped) || IMPERATIVE_LINE.test(stripped)) {
      return "command_invocation";
    }
    if (rule === "prompt.override" && PROMPT_COMMAND.test(stripped)) {
      return "command_invocation";
    }
    return "documentation";
  }

  if (
    stripped.startsWith("#") ||
    stripped.startsWith("//") ||
    stripped.startsWith("*") ||
    stripped.startsWith("/*")
  ) {
    return "documentation";
  }
  return "command_invocation";
}

function collectFromText(rel, content, findings) {
  const lines = content.split(/\r?\n/);
  const starts = newlineStarts(content);
  const fence = lines.map(() => false);
  let inFence = false;
  let language = "";
  for (let i = 0; i < lines.length; i += 1) {
    const lang = fenceLanguage(lines[i]);
    if (lang != null) {
      if (inFence) {
        inFence = false;
        language = "";
      } else {
        inFence = true;
        language = lang;
      }
    }
    fence[i] = inFence && SHELL_FENCE_LANGUAGES.has(language);
  }
  for (const spec of RULES) {
    spec.pattern.lastIndex = 0;
    let match;
    while ((match = spec.pattern.exec(content))) {
      const line = lineNumberAt(starts, match.index);
      const lineIndex = Math.max(0, line - 1);
      const context = lineContext(rel, lines, lineIndex, spec.rule, fence[lineIndex]);
      if (context !== "command_invocation") continue;
      if (
        findings.some(
          (item) =>
            item.file === rel &&
            item.line === line &&
            item.rule === spec.rule,
        )
      ) {
        continue;
      }
      const subsumedBy = SUBSUMED[spec.rule];
      if (
        subsumedBy &&
        findings.some(
          (item) =>
            item.file === rel &&
            item.line === line &&
            subsumedBy.has(item.rule),
        )
      ) {
        continue;
      }
      findings.push({
        severity: spec.severity,
        rule: spec.rule,
        message: spec.message,
        file: rel,
        line,
      });
    }
  }
}

function listTextFiles(root) {
  const files = [];
  const walk = (current, rel, depth) => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
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
      let listed;
      try {
        listed = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (listed.isSymbolicLink()) continue;
      if (listed.isDirectory()) {
        walk(abs, nextRel, depth + 1);
        continue;
      }
      if (!listed.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!COMPANION_EXTENSIONS.has(ext)) continue;
      files.push({ abs, rel: nextRel, size: listed.size });
    }
  };
  walk(root, "", 0);
  return files;
}

function resolveWalkRoot(root) {
  try {
    const listed = fs.lstatSync(root);
    if (listed.isSymbolicLink()) return fs.realpathSync(root);
  } catch {
    /* missing */
  }
  return path.resolve(root);
}

/**
 * @param {{ root: string, skillFile: string, text: string, fileOnly?: boolean }} input
 * @returns {{ severity: string, findings: { severity: string, rule: string, message: string, file: string, line: number }[] }}
 */
export function auditSkill(input) {
  const findings = [];
  const skillRel = path.basename(input.skillFile);
  if (typeof input.text === "string" && input.text) {
    collectFromText(skillRel, input.text, findings);
  }

  if (!input.fileOnly) {
    const start = resolveWalkRoot(input.root);
    const already = path.resolve(input.skillFile);
    let treeBytes = Buffer.byteLength(input.text || "", "utf8");
    for (const file of listTextFiles(start)) {
      if (path.resolve(file.abs) === already) continue;
      if (file.size > MAX_FILE_BYTES) continue;
      if (treeBytes + file.size > MAX_TREE_BYTES) break;
      let content = "";
      try {
        content = fs.readFileSync(file.abs, "utf8");
      } catch {
        continue;
      }
      treeBytes += Buffer.byteLength(content, "utf8");
      collectFromText(file.rel.replace(/\\/g, "/"), content, findings);
    }
  }

  const hasPipe = findings.some((item) => item.rule === "shell.remote-pipe");
  const visible = hasPipe
    ? findings.filter((item) => item.rule !== "network.download")
    : findings;

  return {
    severity: maxSeverity(visible.map((item) => item.severity)),
    findings: visible,
  };
}

export { SEVERITY_ORDER };
