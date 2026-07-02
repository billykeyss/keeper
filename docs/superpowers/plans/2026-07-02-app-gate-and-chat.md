# App Password Gate + Regulations Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the entire webapp behind a shared password, and add a chat panel that answers regulation/stocking questions grounded in Keeper's Postgres via the Claude Agent SDK (lean lockdown config), with inline deep-link citations, SSE streaming, and Postgres-backed shared sessions.

**Architecture:** An app-wide Hono middleware gates every `/api/*` route on an `X-Keeper-Password` header; the SPA shows a full-screen gate before rendering. Chat: one `query()` per user message via `@anthropic-ai/claude-agent-sdk` with three in-process SDK-MCP tools over Postgres; multi-turn context via SDK `resume` (transcripts in a repo-local, gitignored `.chat-sessions/`); Postgres `chat_session`/`chat_message` tables are what the UI lists and shows.

**Tech Stack:** TypeScript, Hono (`streamSSE`), Drizzle + PostgreSQL, `@anthropic-ai/claude-agent-sdk`, React, Vitest (first `vi.mock` usage in this repo).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-regulations-chat-design.md` — its "Agent SDK configuration" block is a HARD requirement; every option listed there must appear verbatim in the implementation (`tools: []`, `allowedTools` = exactly the three `mcp__keeper__*` names, `permissionMode: "dontAsk"`, `strictMcpConfig: true`, `settingSources: []`, `env` spread of `process.env` + `CLAUDE_CONFIG_DIR` redirect + `CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1"`, pinned `cwd`, `maxTurns: 8`, `includePartialMessages: true`, wired `abortController`).
- The gate middleware activates ONLY when `KEEPER_PASSWORD` is set; `vitest.config.ts` must NOT set it globally (existing tests run ungated). Chat routes return 503 unless BOTH `ANTHROPIC_API_KEY` and `KEEPER_PASSWORD` are set.
- `chat_session`/`chat_message` must NOT be added to `TRUNCATE_TABLES` in `src/ingest/load.ts` — chat history survives re-ingests.
- Every task that touches `src/db/schema/*` ends with `npm run db:generate` + `npm run db:migrate`; verify the generated SQL contains ONLY this task's changes (stop and investigate otherwise — the working tree holds unrelated pending data files, and migration drift bundling has bitten this project before).
- Do NOT run `npm run ingest:corridor` during this plan (unverified stocking data files pending in `data/`); do NOT commit anything under `data/`.
- New API routes register in `src/api/server.ts` BEFORE the static-SPA block. `npm` is aliased to `pnpm`. After each task: `npm run typecheck && npm test` green.
- The stocked-fish-browser plan may execute before this one — if a "find" anchor in `web/src/App.tsx` or `web/src/api.ts` has drifted (extra stocked-fish code), adapt the anchor but keep this plan's insertions verbatim.

---

### Task 1: App-wide password middleware

**Files:**
- Create: `src/api/auth.ts`
- Modify: `src/api/server.ts`
- Test: `tests/api/auth.test.ts`

**Interfaces:**
- Produces: `keeperAuth` (Hono `MiddlewareHandler`) and `authRoutes` (Hono sub-app exposing `GET /api/auth/check` → 204) from `src/api/auth.ts`. Behavior: `KEEPER_PASSWORD` unset → pass-through; set → require `X-Keeper-Password` header equal via constant-time compare, else 401 `{ error: "unauthorized" }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/keeper && npx vitest run tests/api/auth.test.ts`
Expected: FAIL — `/api/auth/check` doesn't exist (404/SPA fallback) and no route is gated.

- [ ] **Step 3: Implement the middleware**

Create `src/api/auth.ts`:

```ts
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
```

- [ ] **Step 4: Wire into server.ts**

In `src/api/server.ts`, find:

```ts
import { waters } from "./waters";
import { rules } from "./rules";
```

Add below it:

```ts
import { keeperAuth, authRoutes } from "./auth";
```

Find:

```ts
export const app = new Hono();

app.route("/", waters);
```

Replace with:

```ts
export const app = new Hono();

app.use("/api/*", keeperAuth);
app.route("/", authRoutes);
app.route("/", waters);
```

(If the stocked-fish plan already added `import { stocking } ...`/`app.route("/", stocking);`, keep those lines — only insert the two new lines shown.)

- [ ] **Step 5: Verify pass + full suite + commit**

Run: `npx vitest run tests/api/auth.test.ts && npm run typecheck && npm test`
Expected: all green — existing API tests still pass because vitest never sets `KEEPER_PASSWORD`.

```bash
git add src/api/auth.ts src/api/server.ts tests/api/auth.test.ts
git commit -m "feat(api): app-wide password gate (X-Keeper-Password, KEEPER_PASSWORD env)"
```

---

### Task 2: Frontend PasswordGate

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/PasswordGate.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `GET /api/auth/check` (204/401) from Task 1.
- Produces: `web/src/api.ts` exports `getStoredPassword(): string | null`, `storePassword(pw: string): void`, `clearPassword(): void`; `getJson` attaches the header and, on 401, clears the stored password and dispatches `window` event `"keeper:unauthorized"` before throwing. `PasswordGate({ children })` renders children only after the gate passes.

- [ ] **Step 1: Teach api.ts about the password**

In `web/src/api.ts`, find:

```ts
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
```

Replace with:

```ts
const PASSWORD_KEY = "keeper:password";
export function getStoredPassword(): string | null {
  return localStorage.getItem(PASSWORD_KEY);
}
export function storePassword(pw: string): void {
  localStorage.setItem(PASSWORD_KEY, pw);
}
export function clearPassword(): void {
  localStorage.removeItem(PASSWORD_KEY);
}

/** Headers every API call must carry: JSON accept + the app password when we have one. */
export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const pw = getStoredPassword();
  return { accept: "application/json", ...(pw ? { "x-keeper-password": pw } : {}), ...extra };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: apiHeaders() });
  if (res.status === 401) {
    clearPassword();
    window.dispatchEvent(new Event("keeper:unauthorized"));
    throw new Error("Request failed (401): unauthorized");
  }
  if (!res.ok) {
```

- [ ] **Step 2: Create the gate component**

Create `web/src/PasswordGate.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiHeaders, storePassword, clearPassword } from "./api";

type GateState = "checking" | "locked" | "open";

/** Full-screen password gate for the whole app. Probes /api/auth/check with any stored
 *  password; renders children only on 204. The server enforces the real gate — this is UX.
 *  A 401 anywhere later (api.ts dispatches "keeper:unauthorized") re-locks. */
export function PasswordGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [wrong, setWrong] = useState(false);

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/check", { headers: apiHeaders() });
      if (res.status === 204) { setState("open"); return true; }
    } catch { /* network error — treat as locked so the form shows */ }
    setState("locked");
    return false;
  }, []);

  useEffect(() => { void probe(); }, [probe]);

  useEffect(() => {
    const relock = () => { setState("locked"); setWrong(false); };
    window.addEventListener("keeper:unauthorized", relock);
    return () => window.removeEventListener("keeper:unauthorized", relock);
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pw = new FormData(e.currentTarget).get("password");
    if (typeof pw !== "string" || !pw) return;
    storePassword(pw);
    setWrong(false);
    const ok = await probe();
    if (!ok) { clearPassword(); setWrong(true); }
  };

  if (state === "open") return <>{children}</>;
  if (state === "checking") return <div className="gate" aria-hidden="true" />;

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={onSubmit}>
        <span className="brand-wordmark gate-wordmark">
          Keeper
          <span className="brand-seal" aria-hidden="true" />
        </span>
        <p className="gate-sub">Enter the password to open the ledger.</p>
        <input
          className="gate-input"
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Password"
        />
        {wrong && <p className="gate-error" role="alert">That’s not it — try again.</p>}
        <button className="gate-submit" type="submit">Unlock</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Wrap the app**

In `web/src/App.tsx`, add to the imports:

```ts
import { PasswordGate } from "./PasswordGate";
```

Then find the component's return statement opening `return (` and its outermost `<div className="app">` … `</div>` pair, and wrap it:

```tsx
  return (
    <PasswordGate>
      <div className="app">
        {/* …everything currently inside stays exactly as-is… */}
      </div>
    </PasswordGate>
  );
```

(Keep ALL existing children untouched — only the wrapper is new. Re-indenting the block is fine.)

- [ ] **Step 4: CSS**

Append to `web/src/styles.css` (after the stocked-fish block if present, else after `.brand-sub`):

```css
/* --- app password gate --- */
.gate {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: var(--bone);
}
.gate-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(320px, calc(100vw - 48px));
  padding: 28px 24px;
  border: 1px solid var(--ink-14);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sheet);
  background: color-mix(in srgb, var(--bone) 97%, white);
}
.gate-wordmark { font-size: 26px; }
.gate-sub {
  font-size: 13px;
  color: var(--ink-64);
  margin: 0 0 6px;
}
.gate-input {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--ink);
  padding: 9px 11px;
  border: 1px solid var(--ink-14);
  border-radius: 8px;
  background: white;
}
.gate-error {
  font-size: 12.5px;
  color: var(--closed);
  margin: 0;
}
.gate-submit {
  width: 100%;
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 14px;
  color: var(--bone);
  background: var(--warden);
  border: none;
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
}
```

(Same token rule as always: if a referenced custom property doesn't exist in `:root`, substitute the closest existing one.)

- [ ] **Step 5: Typecheck + build + commit**

Run: `cd ~/keeper && npm run typecheck && npm run build:web`
Expected: green.

```bash
git add web/src/api.ts web/src/PasswordGate.tsx web/src/App.tsx web/src/styles.css
git commit -m "feat(web): full-screen password gate; API calls carry X-Keeper-Password"
```

---

### Task 3: Chat DB schema

**Files:**
- Modify: `src/db/enums.ts`
- Create: `src/db/schema/chat.ts`
- Modify: `src/db/schema/index.ts`
- Test: `tests/db/chat.test.ts`

**Interfaces:**
- Produces: `chatRoleEnum` (`pgEnum("chat_role", ["user","assistant"])`), `chatSession` (`id, title notNull, sdkSessionId nullable, createdAt, updatedAt`), `chatMessage` (`id, sessionId FK notNull, role notNull, content notNull, createdAt, updatedAt`).

- [ ] **Step 1: Write the failing test**

Create `tests/db/chat.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { chatSession, chatMessage } from "../../src/db/schema";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";

afterAll(async () => { await closeDb(); });

const ds: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Donner Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.2437, lat: 39.3237, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ key: "s1", url: "https://example.gov", title: "CCR T14 §7.50", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null }],
  groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50(b)", humanSummary: "5 trout/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } }],
  reciprocity: [], stockingEvents: [], stockingSchedule: [],
};

describe("chat tables", () => {
  it("stores sessions + messages, and both survive a data re-ingest", async () => {
    const [s] = await db.insert(chatSession).values({ title: "Test chat" }).returning();
    await db.insert(chatMessage).values({ sessionId: s.id, role: "user", content: "hi" });
    await db.insert(chatMessage).values({ sessionId: s.id, role: "assistant", content: "hello" });

    await loadDatasets(db, [ds]); // wipe-and-reload of DOMAIN tables must not touch chat

    const sessions = await db.select().from(chatSession);
    const messages = await db.select().from(chatMessage);
    expect(sessions.some((x) => x.id === s.id)).toBe(true);
    expect(messages.filter((m) => m.sessionId === s.id)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/keeper && npx vitest run tests/db/chat.test.ts`
Expected: FAIL — `chatSession`/`chatMessage` are not exported (module error).

- [ ] **Step 3: Add enum + schema**

In `src/db/enums.ts`, append after the last enum line:

```ts
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);
```

Create `src/db/schema/chat.ts`:

```ts
import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";
import { chatRoleEnum } from "../enums";
import { stamps } from "../stamps";

// Chat history is NOT part of the wipe-and-reload ingest world: these tables are
// intentionally absent from TRUNCATE_TABLES in src/ingest/load.ts and must stay that way.
export const chatSession = pgTable("chat_session", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sdkSessionId: text("sdk_session_id"),
  ...stamps,
});

export const chatMessage = pgTable("chat_message", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => chatSession.id),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  ...stamps,
});
```

In `src/db/schema/index.ts`, add to the `export * from` list:

```ts
export * from "./chat";
```

- [ ] **Step 4: Generate + apply the migration**

Run: `npm run db:generate`
Read the generated `migrations/00XX_*.sql` and confirm it contains ONLY `CREATE TYPE "chat_role"`, two `CREATE TABLE`s, and the one FK constraint. Anything else → STOP and investigate.
Run: `npm run db:migrate`
Expected: applied successfully. (The test DB gets migrated by `tests/globalSetup.ts` automatically.)

- [ ] **Step 5: Verify pass + full suite + commit**

Run: `npx vitest run tests/db/chat.test.ts && npm run typecheck && npm test`
Expected: green.

```bash
git add src/db/enums.ts src/db/schema/chat.ts src/db/schema/index.ts migrations/ tests/db/chat.test.ts
git commit -m "feat(db): chat_session + chat_message tables (survive re-ingest)"
```

---

### Task 4: Retrieval tools (plain functions)

**Files:**
- Create: `src/chat/tools.ts`
- Test: `tests/chat/tools.test.ts`

**Interfaces:**
- Produces (all exported from `src/chat/tools.ts`, NO Agent SDK imports in this file):
  - `searchWaters(query: string): Promise<Array<{ id: number; name: string; waterType: string; states: string[]; counties: string[] }>>` (≤8, name/alias/county ILIKE)
  - `getWaterRules(waterId: number): Promise<unknown>` (the full JSON of `GET /api/waters/:id/rules`, obtained by calling the `rules` sub-app in-process; throws on non-200)
  - `searchRegulations(keyword: string, state?: "CA" | "NV"): Promise<Array<{ waterId: number; waterName: string; ruleType: string; citation: string | null; humanSummary: string; sourceUrl: string | null }>>` (≤15)

- [ ] **Step 1: Write the failing tests**

Create `tests/chat/tools.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { waterBody } from "../../src/db/schema";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";
import { searchWaters, getWaterRules, searchRegulations } from "../../src/chat/tools";

afterAll(async () => { await closeDb(); });

const src = { key: "s1", url: "https://example.gov/reg", title: "Test Reg", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null } as const;
const cdfw = { key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] } as const;

const tahoeish: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Big Blue Lake", waterType: "lake", states: ["CA"], counties: ["Placer"], aliases: ["Old Blue"], gnisId: null, lon: -120.10, lat: 39.10, verifyCurrent: false },
  authorities: [{ ...cdfw }], reaches: [], species: [], speciesGroups: [],
  sources: [{ ...src }], groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 2, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "5.05", humanSummary: "Two-fish night bag", verbatimText: "2 per day at night", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } }],
  reciprocity: [], stockingEvents: [], stockingSchedule: [],
};
const nvWater: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Silver Pond", waterType: "pond", states: ["NV"], counties: ["Washoe"], aliases: [], gnisId: null, lon: -119.80, lat: 39.50, verifyCurrent: false },
  authorities: [{ key: "ndow", name: "Nevada Department of Wildlife", state: "NV", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ key: "s1", url: "https://example.gov/nv", title: "NV Reg", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "ndow", retrievedDate: "2026-07-01", quotedText: null }],
  groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 3, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "ndow", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "NV", citation: "NAC 503", humanSummary: "Three-fish night bag", verbatimText: "3 per day at night", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } }],
  reciprocity: [], stockingEvents: [], stockingSchedule: [],
};

let blueId: number;

describe("chat retrieval tools", () => {
  beforeAll(async () => {
    await loadDatasets(db, [tahoeish, nvWater]);
    const ws = await db.select().from(waterBody);
    blueId = ws.find((w) => w.name === "Big Blue Lake")!.id;
  });

  it("searchWaters matches name, alias, and county case-insensitively", async () => {
    expect((await searchWaters("big blue")).map((w) => w.name)).toEqual(["Big Blue Lake"]);
    expect((await searchWaters("old BLUE")).map((w) => w.name)).toEqual(["Big Blue Lake"]);
    expect((await searchWaters("washoe")).map((w) => w.name)).toEqual(["Silver Pond"]);
    expect(await searchWaters("zzz-nothing")).toEqual([]);
  });

  it("getWaterRules returns the resolved rules JSON with sourceUrls", async () => {
    const body = (await getWaterRules(blueId)) as any;
    expect(body.water.name).toBe("Big Blue Lake");
    const bag = body.scopes[0].rules.find((r: any) => r.ruleType === "bag");
    expect(bag.sourceUrl).toBe("https://example.gov/reg");
    await expect(getWaterRules(99999999)).rejects.toThrow();
  });

  it("searchRegulations finds by keyword and filters by state", async () => {
    const all = await searchRegulations("night bag");
    expect(all.map((r) => r.waterName).sort()).toEqual(["Big Blue Lake", "Silver Pond"]);
    expect(all[0].sourceUrl).toMatch(/^https:\/\/example\.gov\//);
    const nv = await searchRegulations("night bag", "NV");
    expect(nv.map((r) => r.waterName)).toEqual(["Silver Pond"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/chat/tools.test.ts`
Expected: FAIL — module `src/chat/tools` doesn't exist.

- [ ] **Step 3: Implement the tools**

Create `src/chat/tools.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { rules } from "../api/rules";

/** Resolve waters by name, alias, or county (case-insensitive substring). ≤8 results. */
export async function searchWaters(query: string) {
  const like = `%${query}%`;
  const rows = (await db.execute(sql`
    select w.id, w.name, w.water_type as "waterType", w.states, w.counties
    from water_body w
    where w.name ilike ${like}
       or exists (select 1 from unnest(w.aliases) a where a ilike ${like})
       or exists (select 1 from unnest(w.counties) ct where ct ilike ${like})
    order by w.name
    limit 8
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name as string,
    waterType: r.waterType as string,
    states: (r.states as string[]) ?? [],
    counties: (r.counties as string[]) ?? [],
  }));
}

/** Full resolved ruleset for one water — reuses the tested /api/waters/:id/rules handler
 *  by invoking the rules sub-app in-process (no HTTP, no import cycle: this imports the
 *  sub-app, not server.ts). */
export async function getWaterRules(waterId: number): Promise<unknown> {
  const res = await rules.request(`/api/waters/${waterId}/rules`);
  if (res.status !== 200) throw new Error(`no water with id ${waterId}`);
  return await res.json();
}

/** Keyword search over regulation text (summary, verbatim, citation), joined to the water
 *  and the primary source URL. Water-body and reach targets only (statewide
 *  authority-territory rules are intentionally excluded — they aren't water-specific). */
export async function searchRegulations(keyword: string, state?: "CA" | "NV") {
  const like = `%${keyword}%`;
  const rows = (await db.execute(sql`
    with reg_water as (
      select t.regulation_id, t.target_id as water_id
        from regulation_target t
       where t.target_type = 'water_body' and t.mode = 'include'
      union
      select t.regulation_id, rc.water_body_id
        from regulation_target t
        join reach rc on rc.id = t.target_id
       where t.target_type = 'reach' and t.mode = 'include'
    )
    select distinct r.id as "regId", w.id as "waterId", w.name as "waterName",
           r.rule_type as "ruleType", r.citation, r.human_summary as "humanSummary",
           (select s.url from regulation_source rs join source s on s.id = rs.source_id
             where rs.regulation_id = r.id and rs.role = 'primary' limit 1) as "sourceUrl"
    from regulation r
    join reg_water rw on rw.regulation_id = r.id
    join water_body w on w.id = rw.water_id
    where r.status in ('verified', 'published')
      and (r.human_summary ilike ${like} or r.verbatim_text ilike ${like} or r.citation ilike ${like})
      and (${state ?? null}::text is null or ${state ?? null} = any(w.states))
    order by w.name
    limit 15
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    waterId: Number(r.waterId),
    waterName: r.waterName as string,
    ruleType: r.ruleType as string,
    citation: (r.citation as string | null) ?? null,
    humanSummary: r.humanSummary as string,
    sourceUrl: (r.sourceUrl as string | null) ?? null,
  }));
}
```

- [ ] **Step 4: Verify pass + full suite + commit**

Run: `npx vitest run tests/chat/tools.test.ts && npm run typecheck && npm test`
Expected: green.

```bash
git add src/chat/tools.ts tests/chat/tools.test.ts
git commit -m "feat(chat): read-only retrieval tools over waters/rules/regulations"
```

---

### Task 5: Agent SDK runner (lean lockdown)

**Files:**
- Modify: `package.json` (new dependency)
- Create: `src/chat/prompt.ts`
- Create: `src/chat/mcp.ts`
- Create: `src/chat/agent.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `searchWaters`/`getWaterRules`/`searchRegulations` from Task 4.
- Produces (from `src/chat/agent.ts`):
  ```ts
  export interface ChatTurnEvents {
    onDelta: (text: string) => void | Promise<void>;
    onTool: (name: string) => void | Promise<void>;
  }
  export interface ChatTurnResult { text: string; sdkSessionId: string; costUsd: number | null }
  export function chatConfigured(): boolean;
  export function runChatTurn(
    userText: string,
    opts: { resumeSessionId: string | null; abortController: AbortController; events: ChatTurnEvents },
  ): Promise<ChatTurnResult>;
  ```
  Task 6 mocks exactly this module path (`src/chat/agent`) in tests.

- [ ] **Step 1: Install the SDK**

Run: `cd ~/keeper && npm add @anthropic-ai/claude-agent-sdk`
Expected: installs (a zod peer-dependency warning about zod@^4 vs the repo's zod@^3 is expected — the docs accept both for tool schemas; the Task 8 smoke test is the gate). Also append to `.gitignore`:

```
.chat-sessions/
```

- [ ] **Step 2: System prompt**

Create `src/chat/prompt.ts`:

```ts
/** System prompt for the Keeper regulations chat. The hard rules here are the citation
 *  and no-guessing contract from the design spec — edit deliberately. */
export function buildSystemPrompt(todayISO: string): string {
  return `You are Keeper's fishing-regulations assistant for California and Nevada waters.

Today's date: ${todayISO}.

Hard rules:
- Answer ONLY from tool results. Never answer regulation, season, bag/size-limit, license, or stocking questions from memory.
- Resolve the water first with search_waters, then fetch its rules with get_water_rules. Use search_regulations for cross-water or keyword questions.
- Cite every specific figure (limits, dates, seasons, stocking quantities) with an inline markdown link whose URL is a sourceUrl returned by a tool in THIS conversation, e.g. [CCR §7.50(b)](https://example.gov/...). Never invent or recall URLs.
- If the tools return nothing relevant, say you don't have data on that and refer the angler to CDFW (wildlife.ca.gov) or NDOW (ndow.org). Never guess.
- Keep answers short and conversational: plain text with inline markdown links; no headers or tables.
- End every answer with: "Always verify current rules with the managing agency before you fish."`;
}
```

- [ ] **Step 3: SDK-MCP tool wrappers**

Create `src/chat/mcp.ts`:

```ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { searchWaters, getWaterRules, searchRegulations } from "./tools";

export const KEEPER_TOOL_NAMES = [
  "mcp__keeper__search_waters",
  "mcp__keeper__get_water_rules",
  "mcp__keeper__search_regulations",
];

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
function fail(e: unknown) {
  // Uncaught throws end the whole query() — always return isError instead.
  return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
}

export const keeperMcpServer = createSdkMcpServer({
  name: "keeper",
  version: "1.0.0",
  tools: [
    tool(
      "search_waters",
      "Find CA/NV fishing waters by name, alias, or county. Returns up to 8 matches with ids for get_water_rules.",
      { query: z.string() },
      async ({ query }) => { try { return ok(await searchWaters(query)); } catch (e) { return fail(e); } },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      "get_water_rules",
      "Get the fully resolved regulations, seasons, licenses, species, and stocking data for one water by id. Every rule includes a sourceUrl to cite.",
      { waterId: z.number().int() },
      async ({ waterId }) => { try { return ok(await getWaterRules(waterId)); } catch (e) { return fail(e); } },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      "search_regulations",
      "Keyword-search regulation text across all waters; optional state filter (CA or NV). Each hit includes waterName, citation, and sourceUrl.",
      { keyword: z.string(), state: z.enum(["CA", "NV"]).optional() },
      async ({ keyword, state }) => { try { return ok(await searchRegulations(keyword, state)); } catch (e) { return fail(e); } },
      { annotations: { readOnlyHint: true } },
    ),
  ],
});
```

- [ ] **Step 4: The runner**

Create `src/chat/agent.ts`:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { keeperMcpServer, KEEPER_TOOL_NAMES } from "./mcp";
import { buildSystemPrompt } from "./prompt";

const KEEPER_ROOT = process.cwd();

export interface ChatTurnEvents {
  onDelta: (text: string) => void | Promise<void>;
  onTool: (name: string) => void | Promise<void>;
}
export interface ChatTurnResult {
  text: string;
  sdkSessionId: string;
  costUsd: number | null;
}

/** Chat is enabled only when both secrets are present — never fall back to the machine's
 *  personal Claude login (fail closed; see design spec req 7). */
export function chatConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.KEEPER_PASSWORD);
}

/** One user turn through the Agent SDK in the spec's lean lockdown configuration.
 *  Streams text deltas / tool-start events through `events`; resolves with the final
 *  text + SDK session id (pass back as resumeSessionId on the next turn). */
export async function runChatTurn(
  userText: string,
  opts: { resumeSessionId: string | null; abortController: AbortController; events: ChatTurnEvents },
): Promise<ChatTurnResult> {
  const q = query({
    prompt: userText,
    options: {
      model: process.env.CHAT_MODEL ?? "claude-haiku-4-5",
      systemPrompt: buildSystemPrompt(new Date().toISOString().slice(0, 10)),
      tools: [],
      allowedTools: [...KEEPER_TOOL_NAMES],
      permissionMode: "dontAsk",
      strictMcpConfig: true,
      settingSources: [],
      mcpServers: { keeper: keeperMcpServer },
      maxTurns: 8,
      includePartialMessages: true,
      resume: opts.resumeSessionId ?? undefined,
      cwd: KEEPER_ROOT,
      abortController: opts.abortController,
      env: {
        ...process.env, // env REPLACES the subprocess environment — losing PATH/the key breaks the CLI
        CLAUDE_CONFIG_DIR: `${KEEPER_ROOT}/.chat-sessions`,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      },
    },
  });

  let text = "";
  let sdkSessionId = "";
  let costUsd: number | null = null;

  for await (const msg of q as AsyncIterable<any>) {
    if (msg.type === "system" && msg.subtype === "init") {
      sdkSessionId = msg.session_id;
      // Lockdown assertion (fail closed): the model must see EXACTLY our three tools.
      const tools: string[] = msg.tools ?? [];
      const unexpected = tools.filter((t) => !KEEPER_TOOL_NAMES.includes(t));
      if (unexpected.length > 0 || tools.length !== KEEPER_TOOL_NAMES.length) {
        opts.abortController.abort();
        throw new Error(`chat lockdown violated — visible tools: [${tools.join(", ")}]`);
      }
      console.log(`[chat] init ok — model=${msg.model} apiKeySource=${msg.apiKeySource}`);
      continue;
    }
    if (msg.type === "stream_event") {
      const ev = msg.event;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text;
        await opts.events.onDelta(ev.delta.text);
      } else if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
        await opts.events.onTool(ev.content_block.name);
      }
      continue;
    }
    if (msg.type === "result") {
      if (msg.subtype !== "success") throw new Error(`chat turn failed: ${msg.subtype}`);
      costUsd = msg.total_cost_usd ?? null;
      sdkSessionId = msg.session_id ?? sdkSessionId;
      if (!text && typeof msg.result === "string") text = msg.result;
    }
  }

  if (!sdkSessionId) throw new Error("chat turn produced no SDK session id");
  console.log(`[chat] turn done — cost=$${costUsd ?? "?"} session=${sdkSessionId}`);
  return { text, sdkSessionId, costUsd };
}
```

(Type note: the SDK exports `SDKMessage` types; the loop uses a narrowed `any` iterator deliberately — the union is large and version-fluid. Keep the `as AsyncIterable<any>` cast local to this loop; everything exported from this module is fully typed.)

- [ ] **Step 5: Typecheck + full suite + commit**

Run: `npm run typecheck && npm test`
Expected: green (nothing imports `agent.ts` yet; the SDK module loads but spawns nothing).

```bash
git add package.json pnpm-lock.yaml .gitignore src/chat/prompt.ts src/chat/mcp.ts src/chat/agent.ts
git commit -m "feat(chat): Agent SDK runner with lean lockdown config + keeper MCP tools"
```

---

### Task 6: Chat API routes (sessions + SSE messages)

**Files:**
- Create: `src/api/chat.ts`
- Modify: `src/api/server.ts`
- Test: `tests/api/chat.test.ts`

**Interfaces:**
- Consumes: `chatSession`/`chatMessage` (Task 3), `runChatTurn`/`chatConfigured` (Task 5 — mocked in tests).
- Produces (all under the Task 1 gate, all 503 unless `chatConfigured()`):
  - `POST /api/chat/sessions` → 201 `{ id, title: "New chat" }`
  - `GET /api/chat/sessions` → `{ sessions: [{ id, title, updatedAt, messageCount }] }` (updatedAt desc)
  - `GET /api/chat/sessions/:id/messages` → `{ messages: [{ id, role, content, createdAt }] }` (asc); 404 unknown id
  - `POST /api/chat/sessions/:id/messages` `{ text }` (≤2000 chars) → SSE: `tool` `{name}` / `delta` `{text}` / `done` `{messageId, costUsd}` / `error` `{message}`; 429 over rate limit; 409 when the session already has a turn in flight
  - `export function resetChatLimiter(): void` (test hook)

- [ ] **Step 1: Write the failing tests**

Create `tests/api/chat.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { chatSession, chatMessage } from "../../src/db/schema";

vi.mock("../../src/chat/agent", () => ({
  chatConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY && process.env.KEEPER_PASSWORD),
  runChatTurn: vi.fn(async (_text: string, opts: any) => {
    await opts.events.onTool("mcp__keeper__search_waters");
    await opts.events.onDelta("Hello ");
    await opts.events.onDelta("world.");
    return { text: "Hello world.", sdkSessionId: "sdk-abc", costUsd: 0.012 };
  }),
}));

// import AFTER vi.mock so the route module binds to the mock
import { app } from "../../src/api/server";
import { resetChatLimiter } from "../../src/api/chat";

const HDRS = { "x-keeper-password": "test-pw" };
const JSON_HDRS = { ...HDRS, "content-type": "application/json" };

function parseSSE(raw: string): Array<{ event: string; data: any }> {
  return raw.split("\n\n").filter((f) => f.includes("event:")).map((frame) => {
    const event = /event: (.+)/.exec(frame)![1].trim();
    const dataLine = /data: (.+)/.exec(frame);
    return { event, data: dataLine ? JSON.parse(dataLine[1]) : null };
  });
}

beforeAll(() => {
  process.env.KEEPER_PASSWORD = "test-pw";
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterAll(async () => {
  delete process.env.KEEPER_PASSWORD;
  delete process.env.ANTHROPIC_API_KEY;
  await closeDb();
});
beforeEach(() => resetChatLimiter());

describe("chat API", () => {
  it("503s when chat is not configured", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const res = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    expect(res.status).toBe(503);
    process.env.ANTHROPIC_API_KEY = saved;
  });

  it("creates, lists, and reads sessions", async () => {
    const created = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const list = await (await app.request("/api/chat/sessions", { headers: HDRS })).json();
    expect(list.sessions.some((s: any) => s.id === id && s.title === "New chat")).toBe(true);

    const msgs = await (await app.request(`/api/chat/sessions/${id}/messages`, { headers: HDRS })).json();
    expect(msgs.messages).toEqual([]);

    expect((await app.request("/api/chat/sessions/99999999/messages", { headers: HDRS })).status).toBe(404);
  });

  it("streams a turn over SSE and persists both messages + sdk session id", async () => {
    const created = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    const { id } = await created.json();

    const res = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "What are the rules at Big Blue Lake?" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSSE(await res.text());
    expect(frames.find((f) => f.event === "tool")?.data).toEqual({ name: "mcp__keeper__search_waters" });
    expect(frames.filter((f) => f.event === "delta").map((f) => f.data.text).join("")).toBe("Hello world.");
    const done = frames.find((f) => f.event === "done");
    expect(done?.data.costUsd).toBe(0.012);

    const stored = await db.select().from(chatMessage).where(eq(chatMessage.sessionId, id));
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(stored[1].content).toBe("Hello world.");
    const [sess] = await db.select().from(chatSession).where(eq(chatSession.id, id));
    expect(sess.sdkSessionId).toBe("sdk-abc");
    expect(sess.title).toBe("What are the rules at Big Blue Lake?");
  });

  it("rejects oversized messages and rate-limits", async () => {
    const created = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    const { id } = await created.json();

    const big = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "x".repeat(2001) }),
    });
    expect(big.status).toBe(400);

    for (let i = 0; i < 10; i++) {
      const r = await app.request(`/api/chat/sessions/${id}/messages`, {
        method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: `q${i}` }),
      });
      expect(r.status).toBe(200);
      await r.text(); // drain
    }
    const eleventh = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "one too many" }),
    });
    expect(eleventh.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/chat.test.ts`
Expected: FAIL — `src/api/chat` doesn't exist.

- [ ] **Step 3: Implement the routes**

Create `src/api/chat.ts`:

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { chatSession, chatMessage } from "../db/schema";
import { runChatTurn, chatConfigured } from "../chat/agent";

export const chat = new Hono();

// --- simple in-memory limits (single-process server) ---
const WINDOW_MS = 60_000;
const PER_IP_MAX = 10;
const GLOBAL_MAX = 30;
let sends: Array<{ ip: string; at: number }> = [];
const inFlight = new Set<number>();

/** Test hook: clear rate-limit + in-flight state between tests. */
export function resetChatLimiter(): void {
  sends = [];
  inFlight.clear();
}

function overLimit(ip: string): boolean {
  const cutoff = Date.now() - WINDOW_MS;
  sends = sends.filter((s) => s.at > cutoff);
  if (sends.length >= GLOBAL_MAX) return true;
  return sends.filter((s) => s.ip === ip).length >= PER_IP_MAX;
}

const messageBody = z.object({ text: z.string().min(1).max(2000) });

chat.use("/api/chat/*", async (c, next) => {
  if (!chatConfigured()) return c.json({ error: "chat not configured" }, 503);
  return next();
});

chat.post("/api/chat/sessions", async (c) => {
  const [row] = await db.insert(chatSession).values({ title: "New chat" }).returning();
  return c.json({ id: row.id, title: row.title }, 201);
});

chat.get("/api/chat/sessions", async (c) => {
  const rows = await db
    .select({
      id: chatSession.id,
      title: chatSession.title,
      updatedAt: chatSession.updatedAt,
      messageCount: sql<number>`(select count(*)::int from chat_message m where m.session_id = ${chatSession.id})`,
    })
    .from(chatSession)
    .orderBy(desc(chatSession.updatedAt));
  return c.json({ sessions: rows });
});

chat.get("/api/chat/sessions/:id/messages", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "unknown session" }, 404);
  const [sess] = await db.select().from(chatSession).where(eq(chatSession.id, id));
  if (!sess) return c.json({ error: "unknown session" }, 404);
  const rows = await db
    .select({ id: chatMessage.id, role: chatMessage.role, content: chatMessage.content, createdAt: chatMessage.createdAt })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, id))
    .orderBy(chatMessage.id);
  return c.json({ messages: rows });
});

chat.post("/api/chat/sessions/:id/messages", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "unknown session" }, 404);
  const [sess] = await db.select().from(chatSession).where(eq(chatSession.id, id));
  if (!sess) return c.json({ error: "unknown session" }, 404);

  const parsed = messageBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "text is required (max 2000 chars)" }, 400);
  const { text } = parsed.data;

  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (overLimit(ip)) return c.json({ error: "rate limit exceeded — slow down" }, 429);
  if (inFlight.has(id)) return c.json({ error: "a reply is already in progress for this session" }, 409);
  sends.push({ ip, at: Date.now() });
  inFlight.add(id);

  await db.insert(chatMessage).values({ sessionId: id, role: "user", content: text });
  if (sess.title === "New chat") {
    await db.update(chatSession).set({ title: text.slice(0, 60) }).where(eq(chatSession.id, id));
  }

  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());
    try {
      const result = await runChatTurn(text, {
        resumeSessionId: sess.sdkSessionId,
        abortController: ac,
        events: {
          onTool: async (name) => { await stream.writeSSE({ event: "tool", data: JSON.stringify({ name }) }); },
          onDelta: async (t) => { await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: t }) }); },
        },
      });
      const [saved] = await db.insert(chatMessage)
        .values({ sessionId: id, role: "assistant", content: result.text })
        .returning();
      await db.update(chatSession)
        .set({ sdkSessionId: result.sdkSessionId, updatedAt: new Date() })
        .where(eq(chatSession.id, id));
      await stream.writeSSE({ event: "done", data: JSON.stringify({ messageId: saved.id, costUsd: result.costUsd }) });
    } catch (e) {
      console.error("[chat] turn error:", e);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ message: "Something went wrong answering that — try again." }) });
    } finally {
      inFlight.delete(id);
    }
  });
});
```

- [ ] **Step 4: Register before the static block**

In `src/api/server.ts`, add `import { chat } from "./chat";` beside the other route imports, and `app.route("/", chat);` immediately after the existing `app.route(...)` lines (before the `WEB_DIST` block).

- [ ] **Step 5: Verify pass + full suite + commit**

Run: `npx vitest run tests/api/chat.test.ts && npm run typecheck && npm test`
Expected: green.

```bash
git add src/api/chat.ts src/api/server.ts tests/api/chat.test.ts
git commit -m "feat(api): chat sessions + SSE message streaming with rate limits"
```

---

### Task 7: Frontend chat panel

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/ChatPanel.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: Task 6's endpoints + SSE protocol; `apiHeaders()` from Task 2.
- Produces: `ChatPanel({ open, onClose })`; api.ts exports `ChatSessionRow`, `ChatMessageRow`, `fetchChatSessions()`, `createChatSession()`, `fetchChatMessages(id)`, `streamChatMessage(id, text, handlers, signal)`.

- [ ] **Step 1: api.ts chat client**

Append to `web/src/api.ts`:

```ts
// --- chat ---

export interface ChatSessionRow {
  id: number;
  title: string;
  updatedAt: string;
  messageCount: number;
}
export interface ChatMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export async function fetchChatSessions(signal?: AbortSignal): Promise<ChatSessionRow[]> {
  return (await getJson<{ sessions: ChatSessionRow[] }>("/api/chat/sessions", signal)).sessions;
}

export async function createChatSession(): Promise<{ id: number; title: string }> {
  const res = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as { id: number; title: string };
}

export async function fetchChatMessages(id: number, signal?: AbortSignal): Promise<ChatMessageRow[]> {
  return (await getJson<{ messages: ChatMessageRow[] }>(`/api/chat/sessions/${id}/messages`, signal)).messages;
}

export interface ChatStreamHandlers {
  onTool: (name: string) => void;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** POST a chat message and consume the SSE reply stream (fetch + reader — EventSource can't POST). */
export async function streamChatMessage(
  sessionId: number,
  text: string,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ text }),
    signal,
  });
  if (res.status === 401) {
    clearPassword();
    window.dispatchEvent(new Event("keeper:unauthorized"));
    throw new Error("unauthorized");
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    handlers.onError(body?.error ?? `Request failed (${res.status})`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const event = /event: (.+)/.exec(frame)?.[1]?.trim();
      const dataRaw = /data: (.+)/.exec(frame)?.[1];
      if (!event || !dataRaw) continue;
      const data = JSON.parse(dataRaw) as Record<string, unknown>;
      if (event === "tool") handlers.onTool(String(data.name));
      else if (event === "delta") handlers.onDelta(String(data.text));
      else if (event === "done") handlers.onDone();
      else if (event === "error") handlers.onError(String(data.message));
    }
  }
}
```

- [ ] **Step 2: ChatPanel component**

Create `web/src/ChatPanel.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  createChatSession,
  fetchChatMessages,
  fetchChatSessions,
  streamChatMessage,
  type ChatMessageRow,
  type ChatSessionRow,
} from "./api";
import { CloseIcon, ExternalIcon } from "./icons";

/** Render assistant text with ONLY [label](https://…) markdown links converted to anchors —
 *  everything else stays plain text (no markdown lib, no innerHTML). */
function renderWithLinks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={k++} className="rule-link" href={m[2]} target="_blank" rel="noreferrer noopener">
        {m[1]} <ExternalIcon />
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const TOOL_LABEL: Record<string, string> = {
  mcp__keeper__search_waters: "Searching waters…",
  mcp__keeper__get_water_rules: "Reading the regulations…",
  mcp__keeper__search_regulations: "Searching regulation text…",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: Props) {
  const [sessions, setSessions] = useState<ChatSessionRow[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<string | null>(null); // streaming assistant text
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    fetchChatSessions(ac.signal).then(setSessions).catch(() => setSessions([]));
    return () => ac.abort();
  }, [open]);

  useEffect(() => {
    if (active == null) return;
    const ac = new AbortController();
    fetchChatMessages(active, ac.signal).then(setMessages).catch(() => setMessages([]));
    return () => ac.abort();
  }, [active]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, live]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const startNew = useCallback(async () => {
    const s = await createChatSession();
    setSessions(null);
    setActive(s.id);
    setMessages([]);
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || active == null) return;
    setDraft("");
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { id: -Date.now(), role: "user", content: text, createdAt: "" }]);
    setLive("");
    let acc = "";
    try {
      await streamChatMessage(active, text, {
        onTool: (name) => setToolNote(TOOL_LABEL[name] ?? "Looking that up…"),
        onDelta: (t) => { acc += t; setToolNote(null); setLive(acc); },
        onDone: () => {
          setMessages((m) => [...m, { id: -Date.now() - 1, role: "assistant", content: acc, createdAt: "" }]);
          setLive(null);
        },
        onError: (message) => { setError(message); setLive(null); },
      });
    } catch {
      setError("Couldn’t reach the chat service.");
      setLive(null);
    } finally {
      setToolNote(null);
      setBusy(false);
    }
  }, [draft, busy, active]);

  if (!open) return null;

  return (
    <section className="chat-panel" role="dialog" aria-modal="false" aria-label="Regulations chat">
      <div className="chat-head">
        {active != null ? (
          <button className="stocked-back" onClick={() => { setActive(null); setSessions(null); }}>← Chats</button>
        ) : (
          <h2 className="stocked-title">Ask Keeper</h2>
        )}
        <button className="sheet-close stocked-close" aria-label="Close chat" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      {active == null && (
        <>
          <button className="chat-new" onClick={startNew}>+ New chat</button>
          <ul className="stocked-list">
            {(sessions ?? []).map((s) => (
              <li key={s.id}>
                <button className="stocked-row" onClick={() => setActive(s.id)}>
                  <span className="stocked-species-name">{s.title}</span>
                  <span className="stocked-meta">{s.messageCount} message{s.messageCount === 1 ? "" : "s"}</span>
                </button>
              </li>
            ))}
            {sessions?.length === 0 && <li className="stocked-empty">No chats yet — start one.</li>}
            {sessions === null && <li className="stocked-empty">Loading…</li>}
          </ul>
        </>
      )}

      {active != null && (
        <>
          <div className="chat-body" ref={bodyRef}>
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-msg--${m.role}`}>
                {m.role === "assistant" ? renderWithLinks(m.content) : m.content}
              </div>
            ))}
            {toolNote && <div className="chat-tool-note">{toolNote}</div>}
            {live !== null && <div className="chat-msg chat-msg--assistant">{renderWithLinks(live)}</div>}
            {error && <div className="chat-error" role="alert">{error}</div>}
            {messages.length === 0 && live === null && (
              <p className="stocked-empty">Ask about seasons, limits, licenses, or stocking — answers cite the actual regulation.</p>
            )}
          </div>
          <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input
              className="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Can I keep trout at Donner Lake?"
              maxLength={2000}
              aria-label="Chat message"
            />
            <button className="chat-send" type="submit" disabled={busy || !draft.trim()}>Send</button>
          </form>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Mount in App**

In `web/src/App.tsx`: add imports `import { ChatPanel } from "./ChatPanel";`, add state `const [chatOpen, setChatOpen] = useState(false);` beside the other `useState` lines, add a floating button inside the app div (right before `<RulesSheet …/>`):

```tsx
      <button className="chat-fab" onClick={() => setChatOpen((v) => !v)} aria-expanded={chatOpen} aria-label="Open regulations chat">
        Ask
      </button>
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
```

- [ ] **Step 4: CSS**

Append to `web/src/styles.css`:

```css
/* --- regulations chat --- */
.chat-fab {
  position: fixed;
  bottom: calc(var(--safe-bottom, 0px) + 18px);
  right: 16px;
  z-index: 25;
  font-family: var(--font-display);
  font-size: 15px;
  color: var(--bone);
  background: var(--warden);
  border: none;
  border-radius: var(--radius-pill);
  padding: 11px 18px;
  box-shadow: var(--shadow-chip);
  cursor: pointer;
}
.chat-panel {
  position: fixed;
  bottom: calc(var(--safe-bottom, 0px) + 66px);
  right: 16px;
  width: min(380px, calc(100vw - 32px));
  height: min(560px, calc(100dvh - 120px));
  display: flex;
  flex-direction: column;
  background: var(--bone);
  border: 1px solid var(--ink-14);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sheet);
  z-index: 45;
  padding: 12px 14px;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.chat-new {
  align-self: flex-start;
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 12.5px;
  color: var(--warden);
  background: none;
  border: 1px solid var(--ink-14);
  border-radius: var(--radius-pill);
  padding: 6px 11px;
  margin-bottom: 6px;
  cursor: pointer;
}
.chat-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.chat-msg {
  max-width: 88%;
  font-size: 13.5px;
  line-height: 1.45;
  padding: 8px 11px;
  border-radius: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.chat-msg--user {
  align-self: flex-end;
  background: var(--warden);
  color: var(--bone);
}
.chat-msg--assistant {
  align-self: flex-start;
  background: color-mix(in srgb, var(--bone) 88%, var(--ink));
  color: var(--ink);
  border: 1px solid var(--ink-12);
}
.chat-tool-note {
  align-self: flex-start;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink-48);
  padding: 2px 4px;
}
.chat-error {
  font-size: 12.5px;
  color: var(--closed);
  padding: 4px 2px;
}
.chat-compose {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ink-12);
}
.chat-input {
  flex: 1;
  font-family: var(--font-body);
  font-size: 13.5px;
  color: var(--ink);
  background: white;
  border: 1px solid var(--ink-14);
  border-radius: 9px;
  padding: 9px 11px;
}
.chat-send {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 13px;
  color: var(--bone);
  background: var(--warden);
  border: none;
  border-radius: 9px;
  padding: 9px 14px;
  cursor: pointer;
}
.chat-send:disabled {
  opacity: 0.45;
  cursor: default;
}
@media (max-width: 767px) {
  .chat-panel {
    right: 8px;
    left: 8px;
    width: auto;
    height: min(70dvh, 560px);
  }
}
```

- [ ] **Step 5: Typecheck + build + commit**

Run: `cd ~/keeper && npm run typecheck && npm run build:web`
Expected: green.

```bash
git add web/src/api.ts web/src/ChatPanel.tsx web/src/App.tsx web/src/styles.css
git commit -m "feat(web): regulations chat panel with streaming + cited answers"
```

---

### Task 8: Env wiring, deploy, live smoke test

**Files:**
- Modify: `scripts/keeper-tmux.sh`
- Modify: `.env.example`
- Create: `~/keeper/.env` (OUTSIDE git — chmod 600)
- Modify: `docs/deploy-mac-mini.md` (one-line security note update)

**Interfaces:**
- Consumes: everything above. Produces: the live deployment, gated and (if a real `ANTHROPIC_API_KEY` is available) with working chat.

- [ ] **Step 1: Source .env in the supervisor loop**

In `scripts/keeper-tmux.sh`, find:

```bash
if [[ "${1:-}" == "--serve" ]]; then
  # Supervisor loop, running inside the tmux pane.
  cd "$DIR"
  while true; do
```

Replace with:

```bash
if [[ "${1:-}" == "--serve" ]]; then
  # Supervisor loop, running inside the tmux pane.
  cd "$DIR"
  # Secrets (ANTHROPIC_API_KEY, KEEPER_PASSWORD, CHAT_MODEL) live in a chmod-600 .env —
  # sourced here rather than the launchd plist, because a pre-existing tmux server would
  # not inherit plist EnvironmentVariables.
  set -a
  [ -f .env ] && . ./.env
  set +a
  while true; do
```

- [ ] **Step 2: Document the env vars**

Replace the contents of `.env.example` with:

```
DATABASE_URL=postgres://fl:fl@localhost:5433/fishing_law
# App-wide password gate (unset = open, for local dev)
KEEPER_PASSWORD=
# Regulations chat (both required for chat to be enabled)
ANTHROPIC_API_KEY=
CHAT_MODEL=claude-haiku-4-5
```

In `docs/deploy-mac-mini.md`, find the sentence warning that the app is unauthenticated (search for "unauthenticated") and append to that paragraph: `Update: the app now supports an app-wide password gate — set KEEPER_PASSWORD in ~/keeper/.env (chmod 600) and every /api route requires it.`

- [ ] **Step 3: Create the real .env**

```bash
cd ~/keeper
touch .env && chmod 600 .env
cat > .env << 'EOF'
KEEPER_PASSWORD=***REDACTED-see-.env***
CHAT_MODEL=claude-haiku-4-5
EOF
```

Then check whether an Anthropic API key is available in the environment or ask the controller/user for one; append `ANTHROPIC_API_KEY=…` to `.env` if provided. If not provided, proceed — the app gate still works and chat correctly returns 503 until the key is added (fail-closed by design; report this in your summary).

- [ ] **Step 4: Deploy + smoke test**

```bash
cd ~/keeper && npm run build:web
tmux kill-session -t keeper 2>/dev/null; ./scripts/keeper-tmux.sh
sleep 3
# gate: no header -> 401; right header -> 200
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8791/api/waters?bbox=-121,39,-119,40"
curl -s -o /dev/null -w "%{http_code}\n" -H "x-keeper-password: keeper1\$" "http://localhost:8791/api/waters?bbox=-121,39,-119,40"
# SPA still serves (static is ungated)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8791/
```
Expected: `401`, `200`, `200`.

If `ANTHROPIC_API_KEY` was set, run one real chat turn and verify lockdown + citation:

```bash
SID=$(curl -s -X POST -H "x-keeper-password: keeper1\$" -H "content-type: application/json" -d '{}' http://localhost:8791/api/chat/sessions | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -sN -X POST -H "x-keeper-password: keeper1\$" -H "content-type: application/json" \
  -d '{"text":"Can I keep trout at Battle Born Pond?"}' \
  "http://localhost:8791/api/chat/sessions/$SID/messages" | head -60
```
Expected: `tool` events, streamed `delta` text mentioning tool-sourced facts with a markdown link, `done` with a small `costUsd`. Also check the server log (`tmux capture-pane -pt keeper | tail -20`) for the `[chat] init ok — … apiKeySource=…` line and confirm apiKeySource is the env API key, and that `.chat-sessions/` appeared in the repo (gitignored). If chat is not configured, instead verify the 503:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "x-keeper-password: keeper1\$" -H "content-type: application/json" -d '{}' http://localhost:8791/api/chat/sessions
```
Expected: `503`.

- [ ] **Step 5: Browser verification via Playwright**

Navigate to `http://localhost:8791/` — expect the full-screen gate. Enter a wrong password → error message; enter `***REDACTED-see-.env***` → map renders. Reload → still unlocked (localStorage). Open the Ask panel → new chat → (if key present) send a question and confirm streamed answer with a clickable citation link.

- [ ] **Step 6: Commit + ledger**

```bash
cd ~/keeper
git add scripts/keeper-tmux.sh .env.example docs/deploy-mac-mini.md
git commit -m "feat(ops): source .env secrets in the tmux supervisor; document gate + chat env"
```

Append to `.superpowers/sdd/progress.md`: `App gate + chat: Tasks 1-8 complete (commits <shas>), deployed and smoke-tested (chat live: yes/no depending on API key).`
