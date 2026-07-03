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
