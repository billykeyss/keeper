import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { searchWaters, getWaterRules, getStockingHistory, searchRegulations } from "./tools";

export const KEEPER_TOOL_NAMES = [
  "mcp__keeper__search_waters",
  "mcp__keeper__get_water_rules",
  "mcp__keeper__get_stocking_history",
  "mcp__keeper__search_regulations",
];

/** A structured tool result surfaced to the chat UI as an interactive card. `tool` is the
 *  bare tool name (search_waters / get_water_rules / get_stocking_history / search_regulations
 *  / WebSearch); `data` is that tool's raw JSON result. */
export interface ToolCard {
  tool: string;
  data: unknown;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
function fail(e: unknown) {
  // Uncaught throws end the whole query() — always return isError instead.
  return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
}

/** Build the in-process Keeper MCP server for one chat turn. Each tool runs its query, hands
 *  the model the JSON result, AND emits the same result as an interactive card via `onCard`
 *  (we have the structured data in-process, so the UI never has to parse it back out of the
 *  model's stream). Created per turn so `onCard` closes over that turn's event sink. */
export function createKeeperMcpServer(onCard: (card: ToolCard) => void) {
  const run = async (toolName: string, fn: () => Promise<unknown>) => {
    try {
      const data = await fn();
      onCard({ tool: toolName, data });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  };

  return createSdkMcpServer({
    name: "keeper",
    version: "2.0.0",
    tools: [
      tool(
        "search_waters",
        "Find CA/NV fishing waters by name, alias, or county. Returns up to 8 matches with ids for get_water_rules / get_stocking_history.",
        { query: z.string() },
        ({ query }) => run("search_waters", () => searchWaters(query)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "get_water_rules",
        "Get the fully resolved regulations, seasons, licenses, species, and stocking summary for one water by id. Every rule includes a sourceUrl to cite.",
        { waterId: z.number().int() },
        ({ waterId }) => run("get_water_rules", () => getWaterRules(waterId)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "get_stocking_history",
        "Get the full stocking history for one water by id: every recorded dated fish plant (species, quantity, size, date) newest-first, plus any recurring stocking schedule. Each entry includes a sourceUrl. Use for 'what/when has been stocked' questions.",
        { waterId: z.number().int() },
        ({ waterId }) => run("get_stocking_history", () => getStockingHistory(waterId)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "search_regulations",
        "Keyword-search regulation text across all waters; optional state filter (CA or NV). Each hit includes waterName, citation, and sourceUrl.",
        { keyword: z.string(), state: z.enum(["CA", "NV"]).optional() },
        ({ keyword, state }) => run("search_regulations", () => searchRegulations(keyword, state)),
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}
