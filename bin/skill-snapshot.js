#!/usr/bin/env node

import fs from "node:fs";
import { loadCatalog } from "../server/catalog.js";
import {
  createSnapshot,
  installSnapshot,
  validateSnapshot,
  writeSnapshotAtomic,
} from "../server/snapshot.js";
import { defaultUsagePath, UsageStore } from "../server/usage.js";


const HELP = `Usage:
  skill-snapshot generate --source <id> --output <file> [--registry <dir>] [--db <file>]
  skill-snapshot validate --input <file>
  skill-snapshot install --input <file> --directory <snapshot-dir>`;

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

try {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  if (command === "generate") {
    if (!args.source || !args.output) throw new Error(HELP);
    const catalog = loadCatalog({ registryRoot: args.registry });
    const usageStore = new UsageStore({ dbPath: args.db || defaultUsagePath(), inventory: catalog.inventory });
    const snapshot = createSnapshot({ sourceId: args.source, catalog, usageStore });
    writeSnapshotAtomic(snapshot, args.output);
    usageStore.close();
    process.stdout.write(`skill snapshot generated: ${args.source}, ${snapshot.catalog.counts.installations} installations\n`);
  } else if (command === "validate") {
    if (!args.input) throw new Error(HELP);
    const snapshot = validateSnapshot(JSON.parse(fs.readFileSync(args.input, "utf8")));
    process.stdout.write(`skill snapshot valid: ${snapshot.source_id}, schema ${snapshot.schema_version}\n`);
  } else if (command === "install") {
    if (!args.input || !args.directory) throw new Error(HELP);
    const result = installSnapshot(args.input, args.directory);
    process.stdout.write(`skill snapshot installed: ${result.sourceId}\n`);
  } else {
    throw new Error(HELP);
  }
} catch (error) {
  process.stderr.write(`skill snapshot failed: ${error.message}\n`);
  process.exitCode = 1;
}
