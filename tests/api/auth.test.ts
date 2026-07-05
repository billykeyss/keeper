import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeDb } from "../../src/db/client";
import { app } from "../../src/api/server";

afterAll(async () => { await closeDb(); });

describe("chat-only password gate", () => {
  describe("when KEEPER_PASSWORD is set", () => {
    beforeAll(() => { process.env.KEEPER_PASSWORD = "test-pw"; });
    afterAll(() => { delete process.env.KEEPER_PASSWORD; });

    it("rejects the chat gate without the header", async () => {
      const res = await app.request("/api/chat/auth/check");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects a wrong password", async () => {
      const res = await app.request("/api/chat/auth/check", { headers: { "x-keeper-password": "nope" } });
      expect(res.status).toBe(401);
    });

    it("accepts the right password", async () => {
      const res = await app.request("/api/chat/auth/check", { headers: { "x-keeper-password": "test-pw" } });
      expect(res.status).toBe(204);
    });

    it("gates chat routes (401 without the password)", async () => {
      const res = await app.request("/api/chat/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(res.status).toBe(401);
    });

    it("leaves the rest of the API PUBLIC even when a password is set", async () => {
      // no header — the map/rules/stocking API must still respond
      expect((await app.request("/api/waters?bbox=-121,39,-119,40")).status).toBe(200);
      expect((await app.request("/api/species")).status).toBe(200);
    });
  });

  describe("when KEEPER_PASSWORD is unset", () => {
    it("passes the chat gate through and the rest stays public (dev/test default)", async () => {
      expect(process.env.KEEPER_PASSWORD).toBeUndefined();
      expect((await app.request("/api/chat/auth/check")).status).toBe(204);
      expect((await app.request("/api/waters?bbox=-121,39,-119,40")).status).toBe(200);
    });
  });
});
