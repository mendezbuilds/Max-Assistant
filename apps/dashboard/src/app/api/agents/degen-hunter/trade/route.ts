import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";
import { Keypair, Connection, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { decryptPrivateKey, verifyPinWithLockout } from "@max/shared";
import { pinRejectionResponse } from "@/lib/degen-pin";

const SOLANA_RPC_ENDPOINT =
  process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const SOL_MINT = "So11111111111111111111111111111111111111112";
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
  let amountInSmallestUnits: number;

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
    amountInSmallestUnits = Math.floor(solAmount * 1e9);
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
    const tokenAmountToSell = Number(openPosition.tokenAmount) * (percent / 100);
    const TOKEN_DECIMALS = 6;
    amountInSmallestUnits = Math.floor(tokenAmountToSell * Math.pow(10, TOKEN_DECIMALS));
    if (amountInSmallestUnits <= 0) {
      return NextResponse.json({ error: "Position amount too small to sell" }, { status: 400 });
    }
    inputMint = tokenId;
    outputMint = SOL_MINT;
  }

  // 5. Execute Jupiter Swap
  try {
    // 5a. Get quote
    const quoteRes = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallestUnits}&slippageBps=${slippageBps}`,
      { signal: AbortSignal.timeout(12000) }
    );
    const quoteResponse = await quoteRes.json() as any;
    if (!quoteResponse || quoteResponse.error) {
      throw new Error(`Jupiter quote failed: ${quoteResponse?.error || "Unknown"}`);
    }

    // 5b. Get swap transaction
    const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
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

    // 6. Update positions in DB — only on success
    if (action === "buy") {
      const solAmount = parseFloat(amountStr);
      const solPriceUsd = await getSolPriceUsd();
      const tokenPriceUsd = (quoteResponse.outAmount / Math.pow(10, 6)) === 0
        ? 0
        : (solAmount * solPriceUsd) / (quoteResponse.outAmount / Math.pow(10, 6));
      const estimatedTokens = quoteResponse.outAmount
        ? Number(quoteResponse.outAmount) / Math.pow(10, 6)
        : 0;

      await prisma.degenHunterPosition.create({
        data: {
          chatId,
          tokenAddress: tokenId,
          tokenSymbol: quoteResponse.outputMint?.slice(0, 8) ?? tokenId.slice(0, 8),
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
        if (percent >= 100) {
          await prisma.degenHunterPosition.update({
            where: { id: openPosition.id },
            data: { status: "CLOSED", tokenAmount: 0 },
          });
        } else {
          const tokenAmountToSell = Number(openPosition.tokenAmount) * (percent / 100);
          const newTokenAmount = Number(openPosition.tokenAmount) - tokenAmountToSell;
          await prisma.degenHunterPosition.update({
            where: { id: openPosition.id },
            data: { tokenAmount: newTokenAmount },
          });
        }
      }
    }

    return NextResponse.json({ txid, status: "success" });
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[api/degen-hunter/trade] Error:", msg);
    const isInsufficient = msg.includes("insufficient") || msg.includes("0x1");
    return NextResponse.json(
      {
        error: isInsufficient
          ? `Insufficient SOL for trade + fees. Deposit more SOL to ${wallet.publicKey}`
          : `Trade failed: ${msg.substring(0, 300)}`,
      },
      { status: 400 }
    );
  }
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
