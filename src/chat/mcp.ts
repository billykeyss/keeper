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
