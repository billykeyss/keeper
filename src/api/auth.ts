import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** App-wide password gate. Active only when KEEPER_PASSWORD is set in the environment
 *  (read per-request so tests can toggle it): every /api/* request must carry a matching
 *  X-Keeper-Password header. Constant-time comparison; 401 otherwise. */
export const keeperAuth: MiddlewareHandler = async (c, next) => {
  const expected = process.env.KEEPER_PASSWORD;
  if (!expected) return next();
  const got = c.req.header("x-keeper-password") ?? "";
  if (!safeEqual(got, expected)) return c.json({ error: "unauthorized" }, 401);
  return next();
};

/** Cheap probe endpoint for the frontend's PasswordGate: 204 iff the request passes the gate. */
export const authRoutes = new Hono();
authRoutes.get("/api/auth/check", (c) => c.body(null, 204));
