#!/usr/bin/env node

import { loadCatalog } from "../server/catalog.js";
import { recordUsage } from "../server/recorder.js";
import {
  defaultUsagePath,
  discoverHistoryFiles,
  parseAntigravityRecords,
  parseClaudeRecords,
  parseCodexRecords,
  parseKimiRecords,
  UsageStore,
} from "../server/usage.js";

const HELP = "Usage:\n  skill-usage --cli <name> --path <SKILL.md> --session <id> [--repo <path>] [--at <ISO time>]\n  skill-usage import --adapter <claude|kimi|codex|antigravity> --file <JSONL> [--db <SQLite file>] [--registry <directory>]\n  skill-usage history [--db <SQLite file>] [--registry <directory>]";

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(HELP);
    values[key.slice(2)] = value;
  }
  return values;
}

const command = ["import", "history"].includes(process.argv[2]) ? process.argv[2] : "record";

try {
  const args = parseArgs(process.argv.slice(command === "record" ? 2 : 3));
  if (command === "import") {
    const parsers = {
      claude: parseClaudeRecords,
      kimi: parseKimiRecords,
      codex: parseCodexRecords,
      antigravity: parseAntigravityRecords,
    };
    if (!parsers[args.adapter] || !args.file) throw new Error(HELP);
    const catalog = loadCatalog({ registryRoot: args.registry });
    const store = new UsageStore({ dbPath: args.db || defaultUsagePath(), inventory: catalog.inventory });
    const result = store.importJsonlFile(args.file, args.adapter, parsers[args.adapter]);
    store.close();
    process.stdout.write(`skill usage import: ${result.imported} added, ${result.duplicates} duplicates, ${result.errors.length} errors\n`);
    if (result.errors.length) process.exitCode = 1;
  } else if (command === "history") {
    const parsers = {
      claude: parseClaudeRecords,
      kimi: parseKimiRecords,
      codex: parseCodexRecords,
      antigravity: parseAntigravityRecords,
    };
    const catalog = loadCatalog({ registryRoot: args.registry });
    const store = new UsageStore({ dbPath: args.db || defaultUsagePath(), inventory: catalog.inventory });
    const history = discoverHistoryFiles();
    let errorCount = 0;
    for (const [adapter, parser] of Object.entries(parsers)) {
      const result = store.importHistoryFiles(history[adapter], adapter, parser);
      errorCount += result.errors.length;
      process.stdout.write(`${adapter}: ${result.imported} added, ${result.duplicates} duplicates, ${result.errors.length} errors\n`);
    }
    const reindexed = store.reindex();
    process.stdout.write(`identity: ${reindexed.checked} observations checked\n`);
    store.close();
    if (errorCount) process.exitCode = 1;
  } else {
    if (!args.cli || !args.path || !args.session) throw new Error(HELP);
    recordUsage({
      cli: args.cli,
      skillPath: args.path,
      sessionId: args.session,
      repository: args.repo || process.cwd(),
      occurredAt: args.at,
    });
    process.stdout.write("skill usage recorded\n");
  }
} catch (error) {
  process.stderr.write(`skill usage failed: ${error.message}\n`);
  if (command !== "record" || error.message === HELP) process.exitCode = 1;
}
