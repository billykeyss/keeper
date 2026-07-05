import { Hono } from "hono";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { waters } from "./waters";
import { rules } from "./rules";
import { stocking } from "./stocking";
import { keeperAuth, authRoutes } from "./auth";
import { chat } from "./chat";

export const app = new Hono();

// The map/rules/stocking/species API is public. Only the chat (which spends API money)
// sits behind the shared password — the gate is scoped to /api/chat/* here.
app.use("/api/chat/*", keeperAuth);
app.route("/", authRoutes);
app.route("/", waters);
app.route("/", rules);
app.route("/", stocking);
app.route("/", chat);

// Statically serve the built SPA (web/dist) when present. Guarded so tests and the
// API-only workflow don't require a web build to exist.
const WEB_DIST = "./web/dist";
if (existsSync(WEB_DIST)) {
  const { serveStatic } = await import("@hono/node-server/serve-static");
  app.use("/*", serveStatic({ root: WEB_DIST }));
  app.get("*", serveStatic({ path: `${WEB_DIST}/index.html` })); // SPA fallback
}

// `npm run api` entrypoint — only listens when run directly, never when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { serve } = await import("@hono/node-server");
  const port = Number(process.env.PORT) || 8787;
  serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`Keeper API listening on http://localhost:${port}`);
}
