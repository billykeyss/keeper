import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeDb } from "../../src/db/client";
import { app } from "../../src/api/server";

afterAll(async () => { await closeDb(); });

describe("keeper password gate", () => {
  describe("when KEEPER_PASSWORD is set", () => {
    beforeAll(() => { process.env.KEEPER_PASSWORD = "test-pw"; });
    afterAll(() => { delete process.env.KEEPER_PASSWORD; });

    it("rejects /api requests without the header", async () => {
      const res = await app.request("/api/auth/check");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects a wrong password", async () => {
      const res = await app.request("/api/auth/check", { headers: { "x-keeper-password": "nope" } });
      expect(res.status).toBe(401);
    });

    it("accepts the right password", async () => {
      const res = await app.request("/api/auth/check", { headers: { "x-keeper-password": "test-pw" } });
      expect(res.status).toBe(204);
    });

    it("gates existing data routes too", async () => {
      expect((await app.request("/api/waters?bbox=-121,39,-119,40")).status).toBe(401);
      const ok = await app.request("/api/waters?bbox=-121,39,-119,40", { headers: { "x-keeper-password": "test-pw" } });
      expect(ok.status).toBe(200);
    });
  });

  describe("when KEEPER_PASSWORD is unset", () => {
    it("passes everything through (dev/test default)", async () => {
      expect(process.env.KEEPER_PASSWORD).toBeUndefined();
      expect((await app.request("/api/auth/check")).status).toBe(204);
      expect((await app.request("/api/waters?bbox=-121,39,-119,40")).status).toBe(200);
    });
  });
});
