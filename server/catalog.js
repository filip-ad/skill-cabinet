import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";


export const DEFAULT_REGISTRY_ROOT = path.join(os.homedir(), "dev", "agent-skills");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function expandHome(value, home = os.homedir()) {
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return path.resolve(value);
}

function validateInventory(inventory) {
  if (inventory?.schema_version !== 1 || !Array.isArray(inventory.installations)) {
    throw new Error("The governed inventory export has an unsupported schema");
  }
  const ids = new Set();
  for (const row of inventory.installations) {
    if (!row.installation_id || !row.canonical_group_id || !row.location) {
      throw new Error("The governed inventory export has an incomplete row");
    }
    if (typeof row.content_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.content_sha256)) {
      throw new Error(`The governed inventory export has an invalid content digest: ${row.installation_id}`);
    }
    if (ids.has(row.installation_id)) {
      throw new Error(`Duplicate installation ID: ${row.installation_id}`);
    }
    ids.add(row.installation_id);
  }
  if (inventory.counts?.installations !== inventory.installations.length) {
    throw new Error("The governed inventory count does not match its rows");
  }
}

function validateCurrency(currency) {
  if (currency?.schema_version !== 1 || !Array.isArray(currency.targets)) {
    throw new Error("The governed currency export has an unsupported schema");
  }
  if (!currency.checked_at) {
    throw new Error("The governed currency export has no check time");
  }
}

export function loadCatalog({ registryRoot = process.env.SKILL_REGISTRY_ROOT || DEFAULT_REGISTRY_ROOT } = {}) {
  const inventoryPath = path.join(registryRoot, "INVENTORY.json");
  const currencyPath = path.join(registryRoot, "SKILL_CURRENCY.json");
  const inventory = readJson(inventoryPath);
  const currency = readJson(currencyPath);
  validateInventory(inventory);
  validateCurrency(currency);

  const currencyByLocation = new Map(
    currency.targets.map((row) => [row.target, row]),
  );
  const groupsById = new Map(
    (inventory.canonical_groups || []).map((row) => [row.canonical_group_id, row]),
  );
  const installations = inventory.installations.map((row) => ({
    ...row,
    currency: currencyByLocation.get(row.location) || {
      name: row.skill_id,
      target: row.location,
      ownership: row.ownership,
      mechanism: row.source || "not recorded",
      upstream: "not recorded",
      status: "unverifiable",
      installed: "not recorded",
      latest: "not recorded",
      action: "No matching governed currency row",
    },
  }));
  const byId = new Map(installations.map((row) => [row.installation_id, row]));
  return {
    registryRoot,
    inventory,
    currency,
    installations,
    byId,
    groupsById,
    loadedAt: new Date().toISOString(),
  };
}

function contained(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function registeredRoot(installation, home = os.homedir()) {
  return fs.realpathSync(path.dirname(expandHome(installation.location, home)));
}

export function readRegisteredFile(installation, relativePath, home = os.homedir()) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw Object.assign(new Error("File path must be relative"), { status: 400 });
  }
  const root = registeredRoot(installation, home);
  const requested = path.resolve(root, relativePath);
  let resolved;
  try {
    resolved = fs.realpathSync(requested);
  } catch {
    throw Object.assign(new Error("Registered skill file not found"), { status: 404 });
  }
  if (!contained(resolved, root)) {
    throw Object.assign(new Error("File path leaves the registered skill root"), { status: 403 });
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw Object.assign(new Error("Registered path is not a file"), { status: 400 });
  }
  const content = fs.readFileSync(resolved);
  if (relativePath === "SKILL.md") {
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== installation.content_sha256) {
      throw Object.assign(new Error("Registered skill text does not match its governed digest"), { status: 409 });
    }
  }
  return {
    path: relativePath,
    size: content.byteLength,
    content: content.toString("utf8"),
  };
}

export function listRegisteredFiles(installation, home = os.homedir()) {
  const root = registeredRoot(installation, home);
  const files = [];
  const walk = (current, relative, depth) => {
    if (depth > 4 || files.length >= 200) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const next = path.join(current, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      let resolved;
      try {
        resolved = fs.realpathSync(next);
      } catch {
        continue;
      }
      if (!contained(resolved, root)) continue;
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) walk(resolved, rel, depth + 1);
      else if (stat.isFile()) files.push({ path: rel, size: stat.size });
    }
  };
  walk(root, "", 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function readCatalogFile(catalog, installation, relativePath, home = os.homedir()) {
  if (!catalog.embeddedFiles) return readRegisteredFile(installation, relativePath, home);
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw Object.assign(new Error("File path must be relative"), { status: 400 });
  }
  const files = catalog.embeddedFiles.get(installation.installation_id) || [];
  const file = files.find((row) => row.path === relativePath);
  if (!file) throw Object.assign(new Error("Published skill file not found"), { status: 404 });
  return { path: file.path, size: file.size, content: file.content };
}

export function listCatalogFiles(catalog, installation, home = os.homedir()) {
  if (!catalog.embeddedFiles) return listRegisteredFiles(installation, home);
  return (catalog.embeddedFiles.get(installation.installation_id) || [])
    .map(({ path: filePath, size }) => ({ path: filePath, size }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function catalogPayload(catalog) {
  const dimensions = {};
  for (const field of [
    "cli",
    "scope",
    "repository",
    "ownership",
    "governance",
    "source",
  ]) {
    dimensions[field] = [...new Set(catalog.installations.map((row) => row[field]).filter(Boolean))].sort();
  }
  dimensions.currency = [...new Set(catalog.installations.map((row) => row.currency.status))].sort();
  dimensions.source_machine = [...new Set(catalog.installations.map((row) => row.source_id).filter(Boolean))].sort();
  return {
    schema_version: 1,
    loaded_at: catalog.loadedAt,
    currency_checked_at: catalog.currency.checked_at,
    counts: catalog.inventory.counts,
    dimensions,
    skills: catalog.installations,
  };
}
