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
