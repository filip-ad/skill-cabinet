import assert from "node:assert/strict";
import test from "node:test";
import { describeRevision } from "./versions.js";


test("shows a real Codex release version when one exists", () => {
  assert.deepEqual(
    describeRevision("codex:0.153.4; sha256:5d926863f2c2f337"),
    {
      label: "Codex 0.153.4",
      note: "Content 5d926863",
      raw: "codex:0.153.4; sha256:5d926863f2c2f337",
    },
  );
  assert.equal(describeRevision("npm:@openai/codex@0.153.4").label, "Codex 0.153.4");
});

test("shortens exact content, tree, and revision evidence", () => {
  assert.equal(describeRevision("sha256:0e62a42e78d6fc4d").label, "Content 0e62a42e");
  assert.equal(describeRevision("git-tree:037e8078db4b20b4aa25c04f21c6de7d335ec449").label, "Tree 037e8078");
  assert.deepEqual(
    describeRevision("f38fb6cf039b835990d0f49dc161d7c2af99ef69:be10104faded844c01d0f5b1f82e8c9fca15ba20"),
    {
      label: "Tree be10104f",
      note: "Revision f38fb6cf",
      raw: "f38fb6cf039b835990d0f49dc161d7c2af99ef69:be10104faded844c01d0f5b1f82e8c9fca15ba20",
    },
  );
});

test("does not invent missing version evidence", () => {
  assert.equal(describeRevision("not recorded").label, "Not recorded");
});
