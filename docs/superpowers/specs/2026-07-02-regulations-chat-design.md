# Regulations chat + app password gate — design

## Purpose

A chat panel in the Keeper web app that answers natural-language questions
about fishing regulations, keep/bag limits, seasons, licenses, and stocking —
grounded exclusively in Keeper's own Postgres data, with every factual claim
citing a deep link to the actual source document already stored per
regulation/stocking row. Powered by the Claude Agent SDK running server-side
in a locked-down, lean configuration. Alongside it, the **entire webapp**
(not just chat) moves behind a shared password.

## Requirements

1. **Whole-app password gate, server-enforced.** The full app — map, rules,
   and chat — requires the shared password (value supplied via
   `KEEPER_PASSWORD` env var; never committed). The browser collects it once
   on a full-screen gate before the map renders, stores it in `localStorage`,
   and sends it as an `X-Keeper-Password` header on **every `/api/*`
   request**. The server rejects missing/mismatching values with 401 using a
   constant-time comparison; any 401 clears the stored value and re-prompts.
   Static assets (HTML/JS/CSS) remain technically fetchable but contain no
   data — all data flows through the gated API. The gate activates only when
   `KEEPER_PASSWORD` is set in the environment (so dev/tests without it keep
   current behavior); setting it is a deploy-checklist item. Side effect:
   `keeper.billhuang.me` as a whole becomes password-protected.
2. **Grounded answers only.** The model answers via three read-only retrieval
   tools over Keeper's Postgres (below). The system prompt forbids answering
   regulation/stocking questions from general knowledge and requires "I don't
   have data on that — check with CDFW/NDOW" when tools return nothing.
3. **Citations with deep links.** Every specific figure (bag limit, season
   date, stocking quantity...) must carry an inline markdown link whose URL is
   a `sourceUrl` returned by a tool in this conversation — never a URL from
   model memory.
4. **Streaming.** Token-level streaming to the browser over SSE, including
   tool-activity status lines ("searching waters…").
5. **Shared, persistent sessions.** Chat sessions and full message history
   live in the existing Postgres (`chat_session` / `chat_message` tables).
   Anyone who unlocks the chat sees the shared session list and can continue
   any session from any device. History survives server restarts and
   re-ingests.
6. **Cost controls.** `maxTurns` cap per message, in-memory rate limiting,
   user-message length cap, model selectable via `CHAT_MODEL` env
   (default `claude-haiku-4-5`).
7. **Fail closed on chat.** If `ANTHROPIC_API_KEY` or `KEEPER_PASSWORD` is
   absent from the environment, chat endpoints return 503 ("chat not
   configured") — the feature must never silently fall back to the machine's
   personal Claude login/subscription credentials. (The rest of the API stays
   open when `KEEPER_PASSWORD` is unset — it reads free public data; chat is
   held to the stricter bar because it spends money.)

## Architecture

```
Browser (PasswordGate → App) ── X-Keeper-Password on every /api/* call
        │
ChatPanel ──POST /api/chat/sessions/:id/messages (SSE)──▶ Hono route (src/api/chat.ts)
                                                                    │ app-wide password middleware
                                                                    ▼
                                                     Agent SDK query() per turn
                                                     (lean lockdown config, resume
                                                      by stored sdkSessionId)
                                                        │  in-process SDK MCP server
                                                        ▼
                                     3 read-only tools → Postgres (waters/regulations/stocking)
                                                        │
                                     chat_session / chat_message tables (display + listing)
```

One `query()` call per user message. Conversational context is carried by the
SDK's `resume` mechanism (its session transcripts live on the server's disk,
redirected into a repo-local gitignored directory); Postgres is the
authoritative store for what the UI shows and lists. Both are joined by the
`chat_session` row, which records the SDK's `session_id` after the first turn.

## Agent SDK configuration (hard requirements, not suggestions)

Package: `@anthropic-ai/claude-agent-sdk` (new dependency). Every `query()`
call MUST pass exactly this shape:

```ts
query({
  prompt: userMessageText,
  options: {
    model: process.env.CHAT_MODEL ?? "claude-haiku-4-5",
    systemPrompt: KEEPER_SYSTEM_PROMPT,          // custom string — never the claude_code preset
    tools: [],                                   // removes ALL built-ins (Bash/Read/Write/Web*/agents/skills)
    allowedTools: [
      "mcp__keeper__search_waters",
      "mcp__keeper__get_water_rules",
      "mcp__keeper__search_regulations",
    ],
    permissionMode: "dontAsk",                   // headless-safe: unapproved → denied, never prompts
    strictMcpConfig: true,                       // ignore .mcp.json / user settings / plugins
    settingSources: [],                          // no ~/.claude settings, no CLAUDE.md, no skills/hooks
    mcpServers: { keeper: keeperMcpServer },     // the in-process SDK MCP server below
    maxTurns: 8,
    includePartialMessages: true,                // token-level stream events
    resume: sdkSessionId ?? undefined,           // multi-turn continuation
    cwd: KEEPER_ROOT,                            // constant — resume is cwd-keyed
    abortController,                             // aborted from stream.onAbort()
    env: {
      ...process.env,                            // env REPLACES, not merges — must spread
      CLAUDE_CONFIG_DIR: `${KEEPER_ROOT}/.chat-sessions`,  // isolate SDK state from ~/.claude
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
  },
})
```

Rationale for the sharp edges (verified against SDK 0.3.x docs):

- `settingSources: []` + `CLAUDE_CONFIG_DIR` redirect: this machine's
  `~/.claude/CLAUDE.md` documents infrastructure and credential locations;
  neither settings nor personal login state may reach a public-facing chat.
- `env` **replaces** the subprocess environment — omitting the spread strips
  `PATH`/`ANTHROPIC_API_KEY` and breaks the CLI.
- `abortController` wired to client disconnect — otherwise the CLI subprocess
  keeps running (and billing) after the browser leaves.
- **Runtime verification, fail closed:** on the init system message, assert
  `tools` contains exactly the three `mcp__keeper__*` names and nothing else —
  on violation: abort the query, return an error to the client, log loudly.
  `apiKeySource` is logged on every init and verified during the deploy smoke
  test (not hard-asserted: its enum values are undocumented, and a wrong guess
  would brick chat); the fail-closed key requirement is enforced upstream by
  `chatConfigured()` refusing to run without `ANTHROPIC_API_KEY` set.
- `.chat-sessions/` is added to `.gitignore`. SDK JSONL transcripts accumulate
  there; cleanup is a documented operational note (out of scope to automate in v1).
- Known friction to verify at implementation time: the SDK peer-requires
  zod ^4 while the repo uses zod ^3 (docs state both are accepted for tool
  schemas; pnpm auto-installs the peer). A smoke test of one tool call is the
  acceptance gate.

## Retrieval tools (the RAG layer)

Defined in-process via `tool()` + `createSdkMcpServer({ name: "keeper", ... })`
in `src/chat/tools.ts`. All three are read-only, return compact JSON as text
content, catch their own exceptions (returning `isError: true` — an uncaught
throw kills the whole query), and carry `annotations: { readOnlyHint: true }`.

1. **`search_waters(query: string)`** — resolves water names. Case-insensitive
   `ILIKE` against `water_body.name` and each element of `aliases`, plus county
   match. Returns up to 8: `{ id, name, waterType, states, counties }`.
2. **`get_water_rules(waterId: number)`** — the workhorse. Calls the existing,
   tested rules resolver by invoking the `rules` Hono sub-app in-process
   (`rules.request(\`/api/waters/${id}/rules\`)`) — season/bag/size/gear/
   closure resolution, license and reciprocity info, species list, stocking
   events/schedule, and per-rule `sourceUrl`s, all reused without refactoring.
   (Importing the `rules` sub-app, not `server.ts`, avoids an import cycle.)
3. **`search_regulations(keyword: string, state?: "CA" | "NV")`** — keyword
   search (`ILIKE`) across `regulation.human_summary`, `verbatim_text`, and
   `citation`, joined to water names and primary-source URLs. Returns up to 15:
   `{ waterId, waterName, ruleType, citation, humanSummary, sourceUrl }`.

No embeddings in v1 (YAGNI at ~2k regulations): the model reformulates and
retries queries itself, which covers keyword misses. If semantic search is
ever needed, the upgrade path stays in Postgres (`pg_trgm` → full-text →
`pgvector`).

## System prompt (`src/chat/prompt.ts`)

Must encode: answer ONLY from tool results; cite every specific figure as an
inline markdown link using a tool-returned `sourceUrl`; when tools return
nothing relevant, say so and refer to the agency — never guess; always close
with a one-line "verify with the managing agency before you fish" note
(matching the app's existing footer disclaimer); today's date is injected for
season questions; answers are plain conversational text with markdown links
only (no headers/tables — it renders in a narrow panel); keep answers concise.

## Sessions & persistence

New Drizzle schema file `src/db/schema/chat.ts` (exported from
`src/db/schema/index.ts`), migration via `npm run db:generate`:

```ts
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);

export const chatSession = pgTable("chat_session", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),              // first user message, truncated to 60 chars
  sdkSessionId: text("sdk_session_id"),        // captured from init message after first turn
  ...stamps,
});

export const chatMessage = pgTable("chat_message", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => chatSession.id),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),          // user text, or final assistant text (with markdown links)
  ...stamps,
});
```

**These tables are NOT added to `TRUNCATE_TABLES` in `src/ingest/load.ts`** —
chat history must survive data re-ingests. This is the first domain data in
the DB outside the wipe-and-reload world; the ingest test that asserts
truncation coverage must not include them.

Turn flow: insert the user `chat_message` → run `query()` (with `resume` when
`sdkSessionId` exists) → stream deltas to the client → on the result message,
insert the assistant `chat_message` with the final text and store
`sdkSessionId`/update `updatedAt` on the session. If the SDK errors mid-turn,
the user message stays recorded and the client receives an SSE `error` event.
If a stored `sdkSessionId` fails to resume (e.g. transcript deleted), start a
fresh SDK session transparently and overwrite the stored id — Postgres history
is what users see; model-side context loss degrades gracefully.

## Password middleware (app-wide)

A single Hono middleware in `src/api/auth.ts`, registered in `server.ts` as
`app.use("/api/*", keeperAuth)` **before** all route mounts:

- `KEEPER_PASSWORD` unset → pass through (dev/test default; deploy checklist
  sets it in prod).
- Set → require `X-Keeper-Password` header equal by constant-time comparison
  (`crypto.timingSafeEqual` over equal-length buffers); otherwise 401
  `{ error: "unauthorized" }`.
- Existing API tests are unaffected (vitest env does not set
  `KEEPER_PASSWORD`); the middleware's own tests set/restore it locally.

Frontend counterpart: a `PasswordGate` component wraps the app's content in
`App.tsx` — full-screen ledger-styled prompt until a stored password validates
(checked with a cheap `GET /api/waters?bbox=` probe or the first real fetch);
`getJson`/all fetch helpers in `web/src/api.ts` attach the header from
`localStorage` and surface 401 as a `gate:reset` (clear + re-prompt).

## Chat API (`src/api/chat.ts`, behind the same middleware)

Registered in `server.ts` **before** the static-SPA block (the `app.get("*")`
fallback swallows later GET routes).

- `POST /api/chat/sessions` `{}` → `{ id, title: "New chat" }` (title updated
  on first message).
- `GET /api/chat/sessions` → `{ sessions: [{ id, title, updatedAt, messageCount }] }`
  ordered by `updatedAt` desc.
- `GET /api/chat/sessions/:id/messages` → `{ messages: [{ id, role, content, createdAt }] }`.
- `POST /api/chat/sessions/:id/messages` `{ text: string }` (zod-validated,
  max 2,000 chars) → **SSE stream** via `streamSSE` from `hono/streaming`:
  - `event: tool` `{ name }` — on each tool_use content block (UI status line)
  - `event: delta` `{ text }` — text deltas (from `stream_event` messages)
  - `event: done` `{ messageId, costUsd }` — after persistence
  - `event: error` `{ message }` — sanitized; never leaks internals
- Rate limits (in-memory, per-process): 10 messages/min per IP and 30/min
  global; exceeded → 429. One in-flight message per session (409 on overlap).

## Frontend

- **`web/src/ChatButton.tsx` + `web/src/ChatPanel.tsx`**, mounted in
  `App.tsx` as siblings of `RulesSheet` (no router/store — local state, same
  as everything else). Floating button bottom-right; z-index sits below the
  open rules sheet.
- Panel follows the RulesSheet pattern and the warden's-ledger styling: mobile
  = full-height bottom sheet w/ scrim; desktop (`min-width: 768px`) = fixed
  panel; data-attribute state, existing custom properties (`--bone`, `--ink`,
  fonts), entries in the `prefers-reduced-motion` block.
- No chat-specific password screen — the whole app sits behind the
  `PasswordGate` (see middleware section), so reaching the chat panel already
  implies an accepted password.
- **Session list view** (shared across all users) ↔ **conversation view**;
  new-chat button.
- **Streaming client:** `fetch` + `ReadableStream` reader parsing SSE frames
  (POST body rules out `EventSource`); new `postChatMessage` helper in
  `web/src/api.ts` alongside `getJson`. Tool events render as a transient
  status line; deltas append to the live assistant bubble.
- **Safe citation rendering:** no markdown library and no `innerHTML`. A tiny
  linkifier parses only `[text](https://…)` spans into `<a target="_blank"
  rel="noreferrer noopener">` React elements; everything else renders as plain
  text. Reuses `.rule-link` link styling + `ExternalIcon`.

## Environment & deployment

Nothing in this repo loads `.env` today (no dotenv; `.env.example` is
documentation). Wiring:

- `~/keeper/.env` (chmod 600, already gitignored):
  `ANTHROPIC_API_KEY=…`, `KEEPER_PASSWORD=…`, optional `CHAT_MODEL=…`.
- `scripts/keeper-tmux.sh` `--serve` branch gains, after `cd "$DIR"`:
  `set -a; [ -f .env ] && . ./.env; set +a` — sourcing inside the supervise
  loop survives restarts, and works regardless of which tmux server owns the
  session (plist `EnvironmentVariables` alone does not reliably reach the pane).
- Dev: same file sourced manually (`set -a; source .env; set +a`) before
  `npm run api`.
- Deploy = rebuild web (`npm run build:web`), restart
  (`tmux kill-session -t keeper; launchctl kickstart gui/$(id -u)/com.keeper.portal`),
  then a live smoke test: password rejected without header; one real question
  answers with a citation link; init-message assertions (tool list, key
  source) logged clean.

## Cost profile

Haiku 4.5 default ≈ $0.01–0.02 per question at lean config; ~600
questions/month ≈ $5–15. `CHAT_MODEL=claude-sonnet-5` is the one-line quality
upgrade. Per-query `total_cost_usd` from the SDK result message is logged
server-side (`console.log`, visible in the tmux/launchd logs).

## Testing

- **Password middleware:** `app.request` with missing/wrong/correct header →
  401/401/pass-through when `KEEPER_PASSWORD` is set (set/restored locally in
  the test file); pass-through when unset; chat routes 503 when
  `ANTHROPIC_API_KEY`/`KEEPER_PASSWORD` unset. Existing waters/rules tests run
  unchanged.
- **Tools:** real test DB (seeded via `loadDatasets`, same as
  `tests/api/rules.test.ts`): `search_waters` finds by alias; `get_water_rules`
  returns rules with `sourceUrl`s; `search_regulations` filters by state;
  each returns `isError: true` (not a throw) on bad input.
- **Session routes:** create/list/history against the real test DB; verify
  chat tables survive a `loadDatasets` wipe (the survives-reingest guarantee).
- **Message route:** first `vi.mock` in the repo — the SDK is wrapped in a thin
  module (`src/chat/agent.ts` exporting `runChatTurn(...)`) precisely so tests
  can mock it; assert SSE framing, persistence of both messages, rate limiting,
  and in-flight 409. Chat-specific env values are set/restored inside the chat
  test files (never globally in `vitest.config.ts`, so the rest of the suite
  keeps running ungated).
- **The live SDK loop** is exercised by the deploy smoke test, not CI.

## Out of scope (v1)

- User accounts / per-user session privacy (single shared password).
- Embeddings/vector search (`pgvector` is the later path if needed).
- Web search / live agency-page browsing (Agent SDK makes this a later
  option flag + prompt change, but v1 is DB-grounded only).
- Automated cleanup of `.chat-sessions/` JSONL transcripts (documented note).
- Session rename/delete UI, cost dashboards, mobile push, etc.
