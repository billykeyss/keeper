import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { regulation, regulationTarget, regulationSpecies, regulationSource } from "../db/schema";

function dayBefore(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Immutable versioning: close the old row's validity, insert a new version, clone all satellites onto it.
export async function supersedeRegulation(
  oldId: number,
  changes: { parameters?: unknown; humanSummary?: string; verbatimText?: string | null; validFrom: string },
) {
  return await db.transaction(async (tx) => {
    const [old] = await tx.select().from(regulation).where(eq(regulation.id, oldId));
    if (!old) throw new Error(`regulation ${oldId} not found`);

    await tx.update(regulation).set({ validTo: dayBefore(changes.validFrom), status: "superseded" }).where(eq(regulation.id, oldId));

    const { id: _drop, createdAt: _c, updatedAt: _u, ...carry } = old as any;
    const [next] = await tx.insert(regulation).values({
      ...carry,
      parameters: changes.parameters ?? old.parameters,
      humanSummary: changes.humanSummary ?? old.humanSummary,
      verbatimText: changes.verbatimText ?? old.verbatimText,
      validFrom: changes.validFrom,
      validTo: null,
      status: "published",
      supersedesId: oldId,
    }).returning();

    for (const t of await tx.select().from(regulationTarget).where(eq(regulationTarget.regulationId, oldId)))
      await tx.insert(regulationTarget).values({ regulationId: next.id, targetType: t.targetType, targetId: t.targetId, mode: t.mode });
    for (const s of await tx.select().from(regulationSpecies).where(eq(regulationSpecies.regulationId, oldId)))
      await tx.insert(regulationSpecies).values({ regulationId: next.id, speciesId: s.speciesId, speciesGroupId: s.speciesGroupId, role: s.role, mode: s.mode });
    for (const s of await tx.select().from(regulationSource).where(eq(regulationSource.regulationId, oldId)))
      await tx.insert(regulationSource).values({ regulationId: next.id, sourceId: s.sourceId, role: s.role, sectionRef: s.sectionRef });

    return next;
  });
}
