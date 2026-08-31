import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (existsSync("dist/index.html")) process.exit(0);

const result = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
