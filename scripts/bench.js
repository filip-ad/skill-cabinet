import { discoverRoots, scanRoots, toCatalogSkill } from "../server/scan.js";

const t = (label, fn) => {
  const start = performance.now();
  const result = fn();
  console.log(`${label}: ${(performance.now() - start).toFixed(0)} ms`);
  return result;
};

const roots = t("discoverRoots", () => discoverRoots());
const index = t("scanRoots (walk+read+audit+origin)", () => scanRoots(roots));
const payload = t("toCatalogSkill + stringify", () =>
  JSON.stringify(index.skills.map(toCatalogSkill)),
);
console.log(`cards: ${index.skills.length}`);
console.log(`payload: ${(payload.length / 1024 / 1024).toFixed(2)} MB`);
