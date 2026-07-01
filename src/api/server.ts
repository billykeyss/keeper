import { Hono } from "hono";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { waters } from "./waters";

export const app = new Hono();

app.route("/", waters);

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
  serve({ fetch: app.fetch, port: 8787 });
  // eslint-disable-next-line no-console
  console.log("API listening on http://localhost:8787");
}
