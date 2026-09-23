import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import express from "express";
import {
  catalogPayload,
  listCatalogFiles,
  loadCatalog,
  readCatalogFile,
} from "./catalog.js";
import { loadSnapshotDirectory } from "./snapshot.js";
import { defaultUsagePath, UsageStore } from "./usage.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join("; ");

function hostName(value) {
  const raw = String(value || "").toLowerCase();
  return raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.split(":")[0];
}

function configuredHosts(value = process.env.SKILL_CABINET_ALLOWED_HOSTS || "") {
  return new Set([
    "127.0.0.1",
    "localhost",
    "::1",
    ...value.split(",").map((item) => hostName(item.trim())).filter(Boolean),
  ]);
}

export function createApp({ catalog, usageStore, distRoot = null, allowedHosts = configuredHosts() } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!allowedHosts.has(hostName(req.headers.host))) {
      res.status(403).json({ error: "Skill Cabinet rejected this host" });
      return;
    }
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") && req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).json({ error: "The dashboard API is read-only" });
      return;
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    const usage = usageStore.aggregates();
    res.json({
      ok: true,
      mode: "read-only",
      inventory_loaded_at: catalog.loadedAt,
      currency_checked_at: catalog.currency.checked_at,
      usage_database: usageStore.dbPath,
      recovered_corruption: usageStore.recovered,
      recovery_path: usageStore.recoveryPath,
      adapter_health: usage.adapter_health,
      snapshot_sources: catalog.sourceHealth || [],
      source_conflicts: catalog.conflicts || [],
      history_limits: {
        claude: "exact structured Skill calls",
        kimi: "exact structured Skill calls",
        codex: "historical visible announcements are inferred",
        antigravity: "history is not counted in v1",
      },
    });
  });

  app.get("/api/catalog", (_req, res) => {
    res.json(catalogPayload(catalog));
  });

  app.get("/api/usage", (_req, res) => {
    res.json(usageStore.aggregates());
  });

  app.get("/api/skills/:id", (req, res, next) => {
    try {
      const installation = catalog.byId.get(req.params.id);
      if (!installation) {
        res.status(404).json({ error: "Governed skill installation not found" });
        return;
      }
      const manuscript = readCatalogFile(catalog, installation, "SKILL.md");
      res.json({
        installation,
        canonical_group: catalog.groupsById.get(installation.canonical_group_id) || null,
        group_installations: catalog.installations.filter(
          (row) => row.canonical_group_id === installation.canonical_group_id,
        ),
        usage: usageStore.forInstallation(installation.installation_id),
        files: listCatalogFiles(catalog, installation),
        manuscript,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/skills/:id/file", (req, res, next) => {
    try {
      const installation = catalog.byId.get(req.params.id);
      if (!installation) {
        res.status(404).json({ error: "Governed skill installation not found" });
        return;
      }
      res.json(readCatalogFile(catalog, installation, String(req.query.path || "")));
    } catch (error) {
      next(error);
    }
  });

  if (distRoot) {
    app.use(express.static(distRoot));
    app.get("/{*splat}", (req, res) => {
      if (req.path.startsWith("/api/")) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.sendFile(path.join(distRoot, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message });
  });
  return app;
}

export function createRuntime() {
  if (process.env.SKILL_CABINET_SNAPSHOT_DIR) {
    return loadSnapshotDirectory(process.env.SKILL_CABINET_SNAPSHOT_DIR);
  }
  const catalog = loadCatalog();
  const usageStore = new UsageStore({ dbPath: defaultUsagePath(), inventory: catalog.inventory });
  return { catalog, usageStore };
}

function openBrowser(url) {
  if (process.env.SKILL_CABINET_NO_OPEN === "1") return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

export function startServer({ port = Number(process.env.PORT || 3781), production = process.env.NODE_ENV === "production" } = {}) {
  const runtime = createRuntime();
  const distRoot = production ? path.join(ROOT, "dist") : null;
  if (distRoot && !fs.existsSync(path.join(distRoot, "index.html"))) {
    throw new Error("Missing dist/. Run `npm run build` first.");
  }
  const app = createApp({ ...runtime, distRoot });
  const server = app.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    process.stdout.write(`Skill Cabinet read-only dashboard at ${url}\n`);
    if (production) openBrowser(url);
  });
  return { server, ...runtime };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
