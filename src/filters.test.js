import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_FILTERS, filterSkills, groupSkills } from "./filters.js";


const skills = [
  { installation_id: "one", display_name: "alpha", description: "First", location: "/one", cli: "codex", scope: "global", repository: "", ownership: "local", governance: "managed", source: "agent-skills", currency: { status: "current" } },
  { installation_id: "two", display_name: "beta", description: "Second", location: "/two", cli: "claude", scope: "repo-local", repository: "/repo", ownership: "repo-owned", governance: "repo-owned-pointer", source: "repository", currency: { status: "intentionally pinned" } },
];

test("combines text, catalog, evidence, identity, and last-use filters", () => {
  const usage = new Map([["one", { occurrence_evidence: "exact", identity_resolution: "resolved", last_use: "2026-09-06T12:00:00Z" }]]);
  const filters = { ...EMPTY_FILTERS, cli: "codex", occurrence: "exact", resolution: "resolved", lastUse: "7" };
  assert.deepEqual(filterSkills(skills, usage, "alp", filters, new Date("2026-09-07T12:00:00Z").valueOf()).map((row) => row.installation_id), ["one"]);
});

test("can select installations with no observed use", () => {
  const filters = { ...EMPTY_FILTERS, occurrence: "none", resolution: "none" };
  assert.deepEqual(filterSkills(skills, new Map(), "", filters).map((row) => row.installation_id), ["one", "two"]);
});

test("a CLI filter includes shared and tool-specific installations", () => {
  const shared = { ...skills[0], installation_id: "shared", cli: "shared" };
  const filters = { ...EMPTY_FILTERS, cli: "codex" };
  assert.deepEqual(filterSkills([...skills, shared], new Map(), "", filters).map((row) => row.installation_id), ["one", "shared"]);
});

test("filters independently by source machine", () => {
  const sourced = [
    { ...skills[0], source_id: "devbox" },
    { ...skills[0], installation_id: "three", source_id: "lenovo" },
  ];
  const filters = { ...EMPTY_FILTERS, sourceMachine: "lenovo" };
  assert.deepEqual(filterSkills(sourced, new Map(), "", filters).map((row) => row.installation_id), ["three"]);
});

test("a repository filter includes only exact repository-local rows", () => {
  const filters = { ...EMPTY_FILTERS, repository: "/repo" };
  assert.deepEqual(filterSkills(skills, new Map(), "", filters).map((row) => row.installation_id), ["two"]);
});

test("groups matching installations into one skill row", () => {
  const installs = [
    { ...skills[0], canonical_group_id: "alpha-group", installation_id: "shared", cli: "shared" },
    { ...skills[0], canonical_group_id: "alpha-group", installation_id: "claude", cli: "claude", currency: { status: "update available" } },
    { ...skills[1], canonical_group_id: "beta-group" },
  ];
  const usage = new Map([
    ["shared", { invocations: 3 }],
    ["claude", { invocations: 8 }],
  ]);
  const groups = groupSkills(installs, installs.slice(0, 2), usage);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].representative.installation_id, "claude");
  assert.equal(groups[0].invocations, 11);
  assert.equal(groups[0].matching_installations, 2);
  assert.equal(groups[0].total_installations, 2);
  assert.equal(groups[0].status, "update available");
});

test("keeps full group size when filters match one installation", () => {
  const installs = [
    { ...skills[0], canonical_group_id: "alpha-group", installation_id: "shared", cli: "shared" },
    { ...skills[0], canonical_group_id: "alpha-group", installation_id: "claude", cli: "claude" },
  ];
  const groups = groupSkills(installs, [installs[1]], new Map());
  assert.equal(groups[0].matching_installations, 1);
  assert.equal(groups[0].total_installations, 2);
});
