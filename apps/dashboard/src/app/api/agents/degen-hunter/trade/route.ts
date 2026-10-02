import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";
import { Keypair, Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { fetchLivePrices } from "@/lib/dex-prices";
import bs58 from "bs58";
import { decryptPrivateKey, verifyPinWithLockout, getTokenHolding, sellAmountRaw, classifyTradeError, MIN_SOL_FOR_FEES } from "@max/shared";
import { pinRejectionResponse } from "@/lib/degen-pin";

const SOLANA_RPC_ENDPOINT =
  process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const SOL_MINT = "So11111111111111111111111111111111111111112";
// Jupiter retired quote-api.jup.ag/v6 (the hostname no longer resolves, so every
// trade failed with a bare "fetch failed"). lite-api is the free, keyless swap
// API with the same quote/swap request and response shape. Override with
// JUPITER_API_BASE (e.g. to api.jup.ag/swap/v1 with a key).
const JUPITER_API = (process.env.JUPITER_API_BASE?.trim() || "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");
const HARD_SPEND_LIMIT_SOL = 1.0;

const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

/**
 * POST /api/agents/degen-hunter/trade
 *
 * Body: {
 *   action: "buy" | "sell",
 *   tokenId: string,         // contract address
 *   amountStr: string,       // SOL amount (buy) or % of position (sell)
 *   slippageBps?: number,    // default 50 (0.5%)
 *   pin: string
 * }
 */
export async function POST(req: NextRequest) {
  // 1. Auth
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    action: string;
    tokenId: string;
    amountStr: string;
    slippageBps?: number;
    pin: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, tokenId, amountStr, slippageBps = 50, pin } = body;

  if (!action || !tokenId || !amountStr || !pin) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (action !== "buy" && action !== "sell") {
    return NextResponse.json({ error: "action must be 'buy' or 'sell'" }, { status: 400 });
  }

  // 2. Verify PIN (rate-limited — see @max/shared's verifyPinWithLockout)
  const pinCheck = await verifyPinWithLockout(chatId, pin);
  if (!pinCheck.ok) {
    return pinRejectionResponse(pinCheck);
  }

  // 3. Load wallet
  const wallet = await prisma.degenHunterWallet.findUnique({ where: { chatId } });
  if (!wallet?.publicKey || !wallet.encryptedKey || !wallet.iv) {
    return NextResponse.json({ error: "No burner wallet found. Create one in Telegram." }, { status: 400 });
  }

  const privKeyBase58 = decryptPrivateKey(wallet.encryptedKey, wallet.iv);
  if (!privKeyBase58) {
    return NextResponse.json({ error: "Failed to decrypt wallet key" }, { status: 500 });
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(privKeyBase58));

  // 4. Compute amounts & validate
  let inputMint: string;
  let outputMint: string;
  let amountInSmallestUnits: string;
  // Sell only: what the wallet REALLY holds and what this sell moves, read from the chain just now (not the recorded amount).
  let sellInfo: { soldUi: number; heldUi: number } | null = null;

  if (action === "buy") {
    const solAmount = parseFloat(amountStr);
    if (isNaN(solAmount) || solAmount <= 0) {
      return NextResponse.json({ error: "Invalid SOL amount" }, { status: 400 });
    }
    if (solAmount > HARD_SPEND_LIMIT_SOL) {
      return NextResponse.json(
        { error: `Hard spend limit is ${HARD_SPEND_LIMIT_SOL} SOL per trade` },
        { status: 400 }
      );
    }
    // Check real balance
    const lamportsBal = await connection.getBalance(keypair.publicKey).catch(() => 0);
    const solBal = lamportsBal / 1e9;
    if (solBal < solAmount + 0.002) {
      return NextResponse.json(
        { error: `Insufficient balance. You have ${solBal.toFixed(4)} SOL (need ${solAmount} + ~0.002 fees)` },
        { status: 400 }
      );
    }
    inputMint = SOL_MINT;
    outputMint = tokenId;
    amountInSmallestUnits = String(Math.floor(solAmount * 1e9));
  } else {
    // SELL
    const percent = parseFloat(amountStr);
    if (isNaN(percent) || percent <= 0 || percent > 100) {
      return NextResponse.json({ error: "Invalid sell percentage" }, { status: 400 });
    }
    // Find open position
    const openPosition = await prisma.degenHunterPosition.findFirst({
      where: { chatId, tokenAddress: tokenId, status: "OPEN" },
    });
    if (!openPosition) {
      return NextResponse.json({ error: "No open position found for this token" }, { status: 400 });
    }
    // The wallet is the source of truth, not the position's recorded amount (which is the buy quote's estimate and can be
    // higher than what was actually delivered — selling "100%" of it asked for tokens that don't exist and failed with 0x1).
    const holding = await getTokenHolding(SOLANA_RPC_ENDPOINT, keypair.publicKey.toBase58(), tokenId);
    if (!holding.ok) {
      return NextResponse.json({ error: `Couldn't read the wallet's balance from the chain right now (${holding.error}). Nothing was sent. Try again in a moment.` }, { status: 503 });
    }
    if (holding.raw === 0n) {
      // Sold or moved outside the app: the position is already closed in reality. Say so, fix the record, and send nothing.
      await prisma.degenHunterPosition.update({ where: { id: openPosition.id }, data: { status: "CLOSED", tokenAmount: 0 } });
      await prisma.$executeRawUnsafe(`UPDATE "DegenHunterPosition" SET closedAt = CURRENT_TIMESTAMP WHERE id = ? AND closedAt IS NULL`, openPosition.id).catch(() => {});
      await logActivity("degen-hunter", "info", `${openPosition.tokenSymbol} position closed: the wallet no longer holds the token`, { kind: "position_reconciled" }).catch(() => {});
      return NextResponse.json(
        { error: `Your wallet no longer holds ${openPosition.tokenSymbol}: it was already sold or moved outside the app. I've marked the position closed. Nothing was sent.`, code: "position-closed-externally" },
        { status: 409 }
      );
    }
    // SOL needed for the fee and any account rent, from the live balance.
    const solLamports = await connection.getBalance(keypair.publicKey).catch(() => null);
    if (solLamports !== null && solLamports / 1e9 < MIN_SOL_FOR_FEES) {
      return NextResponse.json(
        { error: `Not enough SOL for fees: the wallet has ${(solLamports / 1e9).toFixed(5)} SOL and a swap needs about ${MIN_SOL_FOR_FEES} SOL on top of the trade. Deposit SOL to ${wallet.publicKey}.`, code: "sol-for-fees" },
        { status: 400 }
      );
    }
    const rawToSell = sellAmountRaw(holding.raw, percent);
    if (rawToSell <= 0n) {
      return NextResponse.json({ error: "Position amount too small to sell" }, { status: 400 });
    }
    amountInSmallestUnits = rawToSell.toString();
    sellInfo = { soldUi: Number(rawToSell) / Math.pow(10, holding.decimals), heldUi: holding.ui };
    inputMint = tokenId;
    outputMint = SOL_MINT;
  }

  // 5. Execute Jupiter Swap
  try {
    // 5a. Get quote
    const quoteRes = await fetch(
      `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallestUnits}&slippageBps=${slippageBps}`,
      { signal: AbortSignal.timeout(12000) }
    );
    const quoteResponse = await quoteRes.json() as any;
    if (!quoteResponse || quoteResponse.error) {
      throw new Error(`Jupiter quote failed: ${quoteResponse?.error || "Unknown"}`);
    }

    // 5b. Get swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: keypair.publicKey.toString(),
        wrapAndUnwrapSol: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const swapResponse = await swapRes.json() as any;
    if (!swapResponse?.swapTransaction) {
      throw new Error(`Jupiter swap failed: ${swapResponse?.error || "Unknown"}`);
    }

    // 5c. Sign & send
    const txBuf = Buffer.from(swapResponse.swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(txBuf);
    transaction.sign([keypair]);

    const txid = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 2,
    });

    // Wait for confirmation before recording anything. Sending isn't succeeding —
    // a swap can still fail on-chain (slippage, a pulled pool) — and the position
    // is written right below, which used to leave a phantom position behind.
    const confirmation = await connection.confirmTransaction(
      { signature: txid, blockhash: transaction.message.recentBlockhash, lastValidBlockHeight: swapResponse.lastValidBlockHeight },
      "confirmed"
    );
    if (confirmation.value.err) {
      throw new Error(`Swap failed on-chain: ${JSON.stringify(confirmation.value.err)} (tx ${txid})`);
    }

    // 6. Update positions in DB — only on success
    if (action === "buy") {
      const solAmount = parseFloat(amountStr);
      const solPriceUsd = await getSolPriceUsd();
      // The token's real decimals — not an assumed 6 (many tokens use 9, which
      // made the entry price and the amount later sold wrong by 1000×).
      const decimals = await getTokenDecimals(tokenId);
      const estimatedTokens = quoteResponse.outAmount ? Number(quoteResponse.outAmount) / Math.pow(10, decimals) : 0;
      const tokenPriceUsd = estimatedTokens > 0 ? (solAmount * solPriceUsd) / estimatedTokens : 0;
      const buySymbol = (await fetchLivePrices([tokenId]).catch(() => null))?.get(tokenId)?.symbol ?? tokenId.slice(0, 8);

      await prisma.degenHunterPosition.create({
        data: {
          chatId,
          tokenAddress: tokenId,
          // The real symbol (this used to save the first 8 characters of the address as the "symbol").
          tokenSymbol: buySymbol,
          tokenAmount: estimatedTokens,
          amountSOL: solAmount,
          entryPriceUsd: tokenPriceUsd,
          status: "OPEN",
        },
      });
    } else {
      // SELL — close or reduce position
      const percent = parseFloat(amountStr);
      const openPosition = await prisma.degenHunterPosition.findFirst({
        where: { chatId, tokenAddress: tokenId, status: "OPEN" },
      });
      if (openPosition) {
        const tokenAmountToSell = sellInfo?.soldUi ?? Number(openPosition.tokenAmount) * (percent / 100);
        if (percent >= 100) {
          await prisma.degenHunterPosition.update({
            where: { id: openPosition.id },
            data: { status: "CLOSED", tokenAmount: 0 },
          });
        } else {
          const newTokenAmount = sellInfo ? Math.max(0, sellInfo.heldUi - sellInfo.soldUi) : Number(openPosition.tokenAmount) - tokenAmountToSell;
          await prisma.degenHunterPosition.update({
            where: { id: openPosition.id },
            data: { tokenAmount: newTokenAmount },
          });
        }

        // Realized PnL: what this sell actually returned (and, on a full close,
        // the exit price + time) — same bookkeeping as core's Telegram sell
        // flow. Raw SQL because these columns postdate the generated client.
        // Its own try: it must never turn a sell that went through into an error.
        try {
          const solReceived = Number(quoteResponse?.outAmount) / 1e9;
          if (solReceived >= 0) {
            if (percent >= 100) {
              const solUsd = await getSolPriceUsd();
              const exitPrice = tokenAmountToSell > 0 ? (solReceived * solUsd) / tokenAmountToSell : null;
              await prisma.$executeRawUnsafe(
                `UPDATE "DegenHunterPosition" SET realizedSOL = realizedSOL + ?, exitPriceUsd = ?, closedAt = CURRENT_TIMESTAMP WHERE id = ?`,
                solReceived, exitPrice, openPosition.id
              );
            } else {
              await prisma.$executeRawUnsafe(`UPDATE "DegenHunterPosition" SET realizedSOL = realizedSOL + ? WHERE id = ?`, solReceived, openPosition.id);
            }
          }
        } catch (pnlErr) {
          console.error("[api/degen-hunter/trade] could not record realized PnL:", pnlErr);
        }
      }
    }

    return NextResponse.json({ txid, status: "success" });
  } catch (err: any) {
    // Node's fetch reports every network failure as a bare "fetch failed"; the
    // real reason (DNS, refused, timeout…) is on err.cause. Include it.
    const cause = err?.cause?.code ?? err?.cause?.message;
    const msg = (err?.message || String(err)) + (cause ? ` (${cause})` : "");
    console.error("[api/degen-hunter/trade] Error:", msg);
    // Name what actually failed. (This used to be `msg.includes("0x1")`, which also matched slippage 0x1771 and always blamed SOL.)
    const failure = classifyTradeError(msg);
    const detail = failure.kind === "other" ? msg.substring(0, 100) : failure.message.substring(0, 100);
    // Surfaces in the wallet's Recent Activity as a failed transaction. Short detail only; a logging failure must not mask the trade error.
    await logActivity("degen-hunter", "warn", `${action === "buy" ? "Buy" : "Sell"} failed: ${detail}`, {
      kind: "trade_failed",
      label: action === "buy" ? "Buy failed" : "Sell failed",
      detail,
    }).catch(() => {});
    return NextResponse.json(
      {
        error:
          failure.kind === "sol-for-fees"
            ? `${failure.message} Deposit SOL to ${wallet.publicKey}.`
            : failure.kind === "other"
              ? `Trade failed: ${msg.substring(0, 300)}`
              : `Trade failed: ${failure.message}`,
        code: failure.kind,
      },
      { status: 400 }
    );
  }
}

/**
 * A mint's decimals, read from the chain. Falls back to 6 only if the RPC call
 * fails — which is the old behavior, so a failure here is no worse than before.
 */
async function getTokenDecimals(mint: string): Promise<number> {
  try {
    const supply = await connection.getTokenSupply(new PublicKey(mint));
    const d = supply.value.decimals;
    if (Number.isInteger(d) && d >= 0 && d <= 18) return d;
  } catch { /* fall through */ }
  return 6;
}

async function getSolPriceUsd(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json() as any;
    return data?.solana?.usd || 150;
  } catch {
    return 150;
  }
}
