import { prisma } from "@max/db";
import { getTokenHolding, planReconcile, resolveExternalClose, type HoldingResult } from "@max/shared";
import { log } from "../../../logger";
import { rpcEndpoint } from "./rpc";
import { getClosedTradeStats, buildTradeCardPng, tradeCaption } from "./positionPnl";
import { sendTradeCard } from "../telegram/bot";

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
        // The app didn't see this sale: derive the real exit from the wallet's own transactions (or, failing that, the last
        // market price, flagged as an estimate), so the position gets a trade card like any other close.
        await prisma.degenHunterPosition.update({ where: { id: a.id }, data: { status: "CLOSED", tokenAmount: 0 } });
        const exit = await resolveExternalClose(rpcEndpoint(), w.publicKey!, p.tokenAddress, p.createdAt.getTime(), Number(p.tokenAmount)).catch(() => null);
        if (exit) {
          await prisma.$executeRawUnsafe("UPDATE \"DegenHunterPosition\" SET realizedSOL = realizedSOL + ?, exitPriceUsd = ?, closedAt = COALESCE(datetime(?, 'unixepoch'), CURRENT_TIMESTAMP) WHERE id = ? AND exitPriceUsd IS NULL", exit.realizedSOL, exit.exitPriceUsd, exit.closedAtMs ? Math.floor(exit.closedAtMs / 1000) : null, a.id);
        } else {
          await prisma.$executeRawUnsafe(`UPDATE "DegenHunterPosition" SET closedAt = CURRENT_TIMESTAMP WHERE id = ? AND closedAt IS NULL`, a.id);
        }
        log("degen-hunter", exit && !exit.exact ? "warn" : "info", `${p.tokenSymbol} position closed: ${a.reason}${exit ? `; ${exit.note}` : "; no exit price could be determined"}`);
        if (exit) {
          const stats = await getClosedTradeStats(a.id).catch(() => null);
          if (stats) {
            const caption = `${tradeCaption(stats)}
(closed outside the app${exit.exact ? "" : "; exit price is an estimate"})`;
            await sendTradeCard(w.chatId, await buildTradeCardPng(stats, "dark"), caption).catch((e) => log("degen-hunter", "warn", `Could not send trade card for ${p.tokenSymbol}: ${(e as Error).message}`));
          }
        }
      } else {
        await prisma.degenHunterPosition.update({ where: { id: a.id }, data: { tokenAmount: a.amount } });
        log("degen-hunter", "info", `${p.tokenSymbol} position amount corrected to the wallet's real balance (${a.was} → ${a.amount})`);
      }
    }
  }
}
