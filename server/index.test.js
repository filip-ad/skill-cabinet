import assert from "node:assert/strict";
import { after, test } from "node:test";
import { app } from "./index.js";

const MUTATING = [
  "/api/skills/delete",
  "/api/skills/quarantine",
  "/api/skills/restore",
];

const server = await new Promise((resolve, reject) => {
  const bound = app.listen(0, "127.0.0.1");
  bound.on("listening", () => resolve(bound));
  bound.on("error", reject);
});
const { port } = server.address();

after(
  () =>
    new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

async function post(pathname, { origin, body = { ids: ["x"] } } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin !== undefined) headers.origin = origin;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

for (const pathname of MUTATING) {
  test(`${pathname} rejects a request with no Origin`, async () => {
    const res = await post(pathname);
    assert.equal(res.status, 403);
    assert.equal(res.data.error, "Cross-origin request blocked");
  });

  test(`${pathname} rejects a request from a non-loopback Origin`, async () => {
    const res = await post(pathname, { origin: "http://evil.example" });
    assert.equal(res.status, 403);
  });

  test(`${pathname} accepts a loopback Origin before acting`, async () => {
    const res = await post(pathname, {
      origin: "http://127.0.0.1:5173",
      body: { ids: [] },
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "No cards selected");
  });
}

test("localhost and ::1 Origins are loopback", async () => {
  const local = await post("/api/skills/delete", {
    origin: "http://localhost:5173",
    body: { ids: [] },
  });
  const v6 = await post("/api/skills/delete", {
    origin: "http://[::1]:3781",
    body: { ids: [] },
  });
  assert.equal(local.status, 400);
  assert.equal(v6.status, 400, `IPv6 Origin was ${v6.status}`);
});

test("DELETE /api/skills/:id is gone", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/skills/skill-a`, {
    method: "DELETE",
    headers: { origin: "http://127.0.0.1:3781" },
  });
  assert.equal(res.status, 404);
});
