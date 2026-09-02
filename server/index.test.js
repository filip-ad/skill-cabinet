import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const summary = { id: "skill-a", name: "Skill A", path: "/fake/skill-a" };

vi.mock("./scan.js", () => ({
  scanSkills: vi.fn(() => ({
    roots: [{ root: "/fake" }],
    skills: [summary],
    byId: new Map([[summary.id, summary]]),
  })),
  readSkill: vi.fn(),
  readSkillFile: vi.fn(),
  assertDeletable: vi.fn((s) => s.path),
  deleteSkillDir: vi.fn(),
}));

const { app } = await import("./index.js");

describe("POST /api/skills/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests with no Origin header", async () => {
    const res = await request(app)
      .post("/api/skills/delete")
      .send({ ids: [summary.id] });
    expect(res.status).toBe(403);
  });

  it("rejects requests from a non-loopback Origin", async () => {
    const res = await request(app)
      .post("/api/skills/delete")
      .set("Origin", "http://evil.com")
      .send({ ids: [summary.id] });
    expect(res.status).toBe(403);
  });

  it("accepts requests from the Vite dev-proxy origin (different port, loopback host)", async () => {
    const res = await request(app)
      .post("/api/skills/delete")
      .set("Origin", "http://127.0.0.1:5173")
      .send({ ids: [summary.id] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toHaveLength(1);
  });

  it("accepts requests from the same-port prod origin", async () => {
    const res = await request(app)
      .post("/api/skills/delete")
      .set("Origin", "http://127.0.0.1:3781")
      .send({ ids: [summary.id] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toHaveLength(1);
  });
});

describe("DELETE /api/skills/:id", () => {
  it("no longer exists as a route (deletion only via the batch endpoint)", async () => {
    const res = await request(app)
      .delete(`/api/skills/${summary.id}`)
      .set("Origin", "http://127.0.0.1:3781");
    expect(res.status).toBe(404);
  });
});
