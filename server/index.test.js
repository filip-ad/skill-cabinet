import assert from "node:assert/strict";
import { test } from "node:test";
import { app, isLoopbackOrigin } from "./index.js";

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("isLoopbackOrigin accepts 127.0.0.1, localhost, and ::1 at any port", () => {
  assert.equal(isLoopbackOrigin("http://127.0.0.1:5173"), true);
  assert.equal(isLoopbackOrigin("http://127.0.0.1:3781"), true);
  assert.equal(isLoopbackOrigin("http://localhost:3781"), true);
  assert.equal(isLoopbackOrigin("http://[::1]:3781"), true);
});

test("isLoopbackOrigin rejects other hosts and missing/invalid origins", () => {
  assert.equal(isLoopbackOrigin("http://evil.com"), false);
  assert.equal(isLoopbackOrigin(undefined), false);
  assert.equal(isLoopbackOrigin("not a url"), false);
});

test("POST /api/skills/delete only accepts a loopback Origin", async () => {
  const server = await listen();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (origin) =>
      fetch(`${base}/api/skills/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify({ ids: ["nope"] }),
      });

    assert.equal((await post(undefined)).status, 403);
    assert.equal((await post("http://evil.com")).status, 403);

    const sameOrigin = await post(base);
    assert.equal(sameOrigin.status, 200);
    const body = await sameOrigin.json();
    assert.equal(body.errors[0].error, "Skill not in the cabinet");
  } finally {
    server.close();
  }
});

test("quarantine and restore use the same loopback Origin check", async () => {
  const server = await listen();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const pathname of ["/api/skills/quarantine", "/api/skills/restore"]) {
      const blocked = await fetch(`${base}${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      });
      assert.equal(blocked.status, 403);
      const ok = await fetch(`${base}${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:5173",
        },
        body: JSON.stringify({ ids: [] }),
      });
      assert.equal(ok.status, 400);
    }
  } finally {
    server.close();
  }
});

test("DELETE /api/skills/:id has no route", async () => {
  const server = await listen();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/skills/nope`, {
      method: "DELETE",
      headers: { Origin: base },
    });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
