import { query } from "@anthropic-ai/claude-agent-sdk";
import { createKeeperMcpServer, KEEPER_TOOL_NAMES, type ToolCard } from "./mcp";
import { buildSystemPrompt } from "./prompt";

const KEEPER_ROOT = process.cwd();
// The model may see exactly our Keeper MCP tools plus the built-in WebSearch — nothing else.
const ALLOWED_TOOL_SET = [...KEEPER_TOOL_NAMES, "WebSearch"];

export interface ChatTurnEvents {
  onDelta: (text: string) => void | Promise<void>;
  onTool: (name: string) => void | Promise<void>;
  /** A structured tool result to render as an interactive card (Keeper tools + WebSearch). */
  onCard: (card: ToolCard) => void | Promise<void>;
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

/** Pull {title,url} web citations out of a WebSearch tool result (WebSearchOutput shape:
 *  { query, results: (string | { content: {title,url}[] })[] }). Tolerant of shape drift. */
function extractWebResults(toolUseResult: unknown): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const results = (toolUseResult as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    const content = (r as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      const url = (c as { url?: unknown })?.url;
      const title = (c as { title?: unknown })?.title;
      if (typeof url === "string") out.push({ title: typeof title === "string" ? title : url, url });
    }
  }
  return out;
}

/** One user turn through the Agent SDK in the locked-down configuration, now with the built-in
 *  WebSearch tool available as a fallback. Streams text deltas, tool-start events, and structured
 *  tool-result cards through `events`; resolves with the final text + SDK session id. */
export async function runChatTurn(
  userText: string,
  opts: { resumeSessionId: string | null; abortController: AbortController; events: ChatTurnEvents },
): Promise<ChatTurnResult> {
  const keeperMcpServer = createKeeperMcpServer((card) => { void opts.events.onCard(card); });

  const q = query({
    prompt: userText,
    options: {
      model: process.env.CHAT_MODEL ?? "claude-haiku-4-5",
      systemPrompt: buildSystemPrompt(new Date().toISOString().slice(0, 10)),
      tools: ["WebSearch"], // enable ONLY WebSearch among built-ins; Bash/Read/Write/etc. stay off
      allowedTools: [...ALLOWED_TOOL_SET],
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
      // Lockdown assertion (fail closed): the model may see EXACTLY our Keeper tools + WebSearch.
      const tools: string[] = msg.tools ?? [];
      const unexpected = tools.filter((t) => !ALLOWED_TOOL_SET.includes(t));
      if (unexpected.length > 0 || tools.length !== ALLOWED_TOOL_SET.length) {
        opts.abortController.abort();
        throw new Error(`chat lockdown violated — visible tools: [${tools.join(", ")}]`);
      }
      console.log(`[chat] init ok — model=${msg.model} apiKeySource=${msg.apiKeySource} tools=${tools.length}`);
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
    // WebSearch results arrive as a tool result on a user message — Keeper MCP tool results are
    // already emitted in-process by createKeeperMcpServer, so only web results are pulled here.
    if (msg.type === "user" && msg.tool_use_result) {
      const web = extractWebResults(msg.tool_use_result);
      if (web.length) await opts.events.onCard({ tool: "WebSearch", data: { results: web } });
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
