import { prisma, logActivity } from "@max/db";
import { getTokenHolding, planReconcile, resolveExternalClose, type HoldingResult } from "@max/shared";

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
      // The app didn't see this sale, so work out the real exit from the wallet's own transactions (or, failing that, the last market
      // price, flagged as an estimate). With an exit price the position gets a trade card like any other close. The columns are raw SQL
      // because they postdate the generated client.
      await prisma.degenHunterPosition.update({ where: { id: a.id }, data: { status: "CLOSED", tokenAmount: 0 } });
      const exit = await resolveExternalClose(rpcUrl, owner, p.tokenAddress, p.createdAt.getTime(), Number(p.tokenAmount)).catch(() => null);
      if (exit) {
        await prisma.$executeRawUnsafe("UPDATE \"DegenHunterPosition\" SET realizedSOL = realizedSOL + ?, exitPriceUsd = ?, closedAt = COALESCE(datetime(?, 'unixepoch'), CURRENT_TIMESTAMP) WHERE id = ? AND exitPriceUsd IS NULL", exit.realizedSOL, exit.exitPriceUsd, exit.closedAtMs ? Math.floor(exit.closedAtMs / 1000) : null, a.id);
      } else {
        await prisma.$executeRawUnsafe(`UPDATE "DegenHunterPosition" SET closedAt = CURRENT_TIMESTAMP WHERE id = ? AND closedAt IS NULL`, a.id).catch(() => {});
      }
      await logActivity("degen-hunter", "info", `${p.tokenSymbol} position closed: ${a.reason}${exit ? `; ${exit.note}` : "; no exit price could be determined"}`, { kind: "position_reconciled" }).catch(() => {});
    } else {
      await prisma.degenHunterPosition.update({ where: { id: a.id }, data: { tokenAmount: a.amount } });
      await logActivity("degen-hunter", "info", `${p.tokenSymbol} position amount corrected to the wallet's real balance (${a.was} → ${a.amount})`, { kind: "position_reconciled" }).catch(() => {});
    }
  }
  return actions.length;
}
