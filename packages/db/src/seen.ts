import { prisma } from "./client";

/**
 * Shared de-dup ledger for scout-style agents (job-scout, and later
 * alpha-scout/apartment-scout/etc.) — a poll runs on a timer and re-fetches
 * the same source every time, so every agent needs "have I already alerted
 * on this one?" without re-implementing it per agent.
 */

/** Filters a batch of externalIds down to the ones never seen before for this agent — one query instead of one per item. */
export async function filterUnseen(agentKey: string, externalIds: string[]): Promise<string[]> {
  if (externalIds.length === 0) return [];

  const seen = await prisma.seenItem.findMany({
    where: { agentKey, externalId: { in: externalIds } },
    select: { externalId: true },
  });
  const seenSet = new Set(seen.map((s) => s.externalId));
  return externalIds.filter((id) => !seenSet.has(id));
}

/**
 * Records a batch of externalIds as seen. Safe to call with ids already
 * marked — upserts one at a time rather than createMany, because Prisma's
 * createMany `skipDuplicates` option isn't supported on SQLite.
 */
export async function markSeen(agentKey: string, externalIds: string[]): Promise<void> {
  for (const externalId of externalIds) {
    await prisma.seenItem.upsert({
      where: { agentKey_externalId: { agentKey, externalId } },
      update: {},
      create: { agentKey, externalId },
    });
  }
}
