import { prisma, logActivity } from "@max/db";
import { getTokenHolding, planReconcile, type HoldingResult } from "@max/shared";

/**
 * Brings OPEN positions in line with the wallet's real token balances: a position whose token the wallet no longer
 * holds (sold on Jupiter, moved elsewhere) is closed, and one whose recorded amount differs from what's really
 * held is corrected. A failed balance lookup changes nothing. Returns how many positions it touched.
 */
export async function reconcilePositions(chatId: string, rpcUrl: string, owner: string): Promise<number> {
  const open = await prisma.degenHunterPosition.findMany({ where: { chatId, status: "OPEN" } });
  if (open.length === 0) return 0;

  const holdings = new Map<string, HoldingResult>();
  for (const mint of new Set(open.map((p) => p.tokenAddress))) holdings.set(mint, await getTokenHolding(rpcUrl, owner, mint));

  const actions = planReconcile(
    open.map((p) => ({ id: p.id, tokenAddress: p.tokenAddress, tokenAmount: Number(p.tokenAmount), createdAtMs: p.createdAt.getTime() })),
    holdings,
    Date.now()
  );

  for (const a of actions) {
    const p = open.find((x) => x.id === a.id)!;
    if (a.type === "close") {
      // closedAt is a raw column (it postdates the generated client). exitPriceUsd stays empty: the app didn't see this sale, so there's no recorded exit and no trade card.
      await prisma.degenHunterPosition.update({ where: { id: a.id }, data: { status: "CLOSED", tokenAmount: 0 } });
      await prisma.$executeRawUnsafe(`UPDATE "DegenHunterPosition" SET closedAt = CURRENT_TIMESTAMP WHERE id = ? AND closedAt IS NULL`, a.id).catch(() => {});
      await logActivity("degen-hunter", "info", `${p.tokenSymbol} position closed: ${a.reason}`, { kind: "position_reconciled" }).catch(() => {});
    } else {
      await prisma.degenHunterPosition.update({ where: { id: a.id }, data: { tokenAmount: a.amount } });
      await logActivity("degen-hunter", "info", `${p.tokenSymbol} position amount corrected to the wallet's real balance (${a.was} → ${a.amount})`, { kind: "position_reconciled" }).catch(() => {});
    }
  }
  return actions.length;
}
