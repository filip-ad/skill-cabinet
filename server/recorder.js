import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCatalog } from "./catalog.js";
import { normalizeEvent } from "./usage.js";


export function defaultRecorderPath() {
  return process.env.SKILL_USAGE_LOG || path.join(os.homedir(), ".local", "share", "skill-cabinet", "usage.jsonl");
}

export function recordUsage({
  cli,
  skillPath,
  sessionId,
  repository,
  occurredAt = new Date().toISOString(),
  registryRoot,
  outputPath = defaultRecorderPath(),
}) {
  const catalog = loadCatalog({ registryRoot });
  const event = normalizeEvent(
    {
      source_id: `${cli}:${occurredAt}:${skillPath}`,
      occurred_at: occurredAt,
      cli,
      session_id: sessionId,
      skill_path: skillPath,
      repository,
      adapter: "recorder",
      parser_version: "recorder-1",
      occurrence_evidence: "exact",
    },
    catalog.inventory,
  );
  if (event.identity_resolution !== "resolved") {
    throw new Error("The skill path is not one exact governed installation");
  }
  const safe = {
    source_id: event.event_id,
    occurred_at: event.occurred_at,
    cli: event.cli,
    session_hash: event.session_hash,
    skill_path: event.skill_path,
    repository: event.repository,
    adapter: "recorder",
    parser_version: "recorder-1",
    occurrence_evidence: "exact",
  };
  const directory = path.dirname(path.resolve(outputPath));
  const directoryExisted = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!directoryExisted || path.basename(directory) === "skill-cabinet") {
    fs.chmodSync(directory, 0o700);
  }
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_APPEND
    | fs.constants.O_CREAT
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(outputPath, flags, 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(safe)}\n`, { encoding: "utf8" });
  } finally {
    fs.closeSync(descriptor);
  }
  return safe;
}
