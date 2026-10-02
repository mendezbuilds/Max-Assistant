import { prisma } from "@max/db";
import { getTokenHolding, planReconcile, type HoldingResult } from "@max/shared";
import { log } from "../../../logger";
import { rpcEndpoint } from "./rpc";

/**
 * Brings OPEN positions in line with the wallet's real token balances (same rule as the dashboard's
 * reconcile): a position whose token the wallet no longer holds is closed — it was sold on Jupiter or moved
 * outside the app — and one whose recorded amount drifted from the real balance is corrected. A failed
 * balance lookup changes nothing. Runs with every tracking cycle, so Telegram and the dashboard stay honest
 * even if nobody has the dashboard open.
 */
export async function reconcileAllPositions(): Promise<void> {
  const wallets = await prisma.degenHunterWallet.findMany({ where: { publicKey: { not: null } } });
  for (const w of wallets) {
    const open = await prisma.degenHunterPosition.findMany({ where: { chatId: w.chatId, status: "OPEN" } });
    if (open.length === 0) continue;

    const holdings = new Map<string, HoldingResult>();
    for (const mint of new Set(open.map((p) => p.tokenAddress))) holdings.set(mint, await getTokenHolding(rpcEndpoint(), w.publicKey!, mint));

    const actions = planReconcile(
      open.map((p) => ({ id: p.id, tokenAddress: p.tokenAddress, tokenAmount: Number(p.tokenAmount), createdAtMs: p.createdAt.getTime() })),
      holdings,
      Date.now()
    );
    for (const a of actions) {
      const p = open.find((x) => x.id === a.id)!;
      if (a.type === "close") {
        // exitPriceUsd stays empty: the app didn't see this sale, so there's no recorded exit (and no trade card).
        await prisma.degenHunterPosition.update({ where: { id: a.id }, data: { status: "CLOSED", tokenAmount: 0 } });
        await prisma.$executeRawUnsafe(`UPDATE "DegenHunterPosition" SET closedAt = CURRENT_TIMESTAMP WHERE id = ? AND closedAt IS NULL`, a.id);
        log("degen-hunter", "info", `${p.tokenSymbol} position closed: ${a.reason}`);
      } else {
        await prisma.degenHunterPosition.update({ where: { id: a.id }, data: { tokenAmount: a.amount } });
        log("degen-hunter", "info", `${p.tokenSymbol} position amount corrected to the wallet's real balance (${a.was} → ${a.amount})`);
      }
    }
  }
}
