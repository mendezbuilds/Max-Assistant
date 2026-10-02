import { Keypair, Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { encryptPrivateKey, decryptPrivateKey } from "@max/shared";
import { prisma } from "@max/db";
import { fetchWithRetry } from "../../../lib/http";
import { getConnection } from "./rpc";

// Jupiter retired quote-api.jup.ag/v6 (the hostname no longer resolves, so every
// trade failed with a bare "fetch failed"). lite-api is the free, keyless swap
// API with the same quote/swap request and response shape. Override with
// JUPITER_API_BASE (e.g. to api.jup.ag/swap/v1 with a key).
export const JUPITER_API = (process.env.JUPITER_API_BASE?.trim() || "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");


/** Plain-English reason for a Jupiter quote error (its raw messages are terse and technical). */
function explainJupiterError(q: any): string {
  const code = q?.errorCode ?? "";
  if (code === "TOKEN_NOT_TRADABLE") {
    return "Jupiter has no route for this token right now. Brand-new tokens can take a few minutes to be indexed, and some never are (unsupported pool, or too little liquidity). Try again shortly, or skip it.";
  }
  if (code === "COULD_NOT_FIND_ANY_ROUTE") {
    return "No swap route was found, usually because liquidity is too thin for this amount. Try a smaller amount.";
  }
  return `Jupiter quote failed: ${q?.error || "Unknown error"}`;
}

/**
 * Asks Jupiter for a quote without sending anything, to find out *before* the
 * owner types a PIN whether a buy can go through, and how much it would move the
 * price. A network failure counts as "unknown" (tradable: true), not "no".
 */
export async function checkTradable(mint: string, lamports: number): Promise<{ tradable: boolean; reason?: string; priceImpactPct?: number }> {
  try {
    const q = await fetchWithRetry(
      `${JUPITER_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports}&slippageBps=300`,
      { method: "GET", timeoutMs: 10000, retries: 1 }
    ).then((r) => r.json() as Promise<any>);
    if (!q || q.error || !q.outAmount) return { tradable: false, reason: explainJupiterError(q) };
    return { tradable: true, priceImpactPct: Number(q.priceImpactPct) * 100 };
  } catch {
    return { tradable: true }; // couldn't reach Jupiter: don't block the trade on a guess
  }
}

/**
 * A mint's decimals, read from the chain. Sells convert a token amount into the
 * token's smallest units, and that used to assume 6 decimals for every token —
 * wrong for the many tokens that use 9, where "sell 100%" sold a thousandth.
 * Falls back to 6 only if the RPC call fails (the old behavior).
 */
export async function getTokenDecimals(mint: string): Promise<number> {
  try {
    const supply = await getConnection().getTokenSupply(new PublicKey(mint));
    const d = supply.value.decimals;
    if (Number.isInteger(d) && d >= 0 && d <= 18) return d;
  } catch { /* fall through */ }
  return 6;
}

export async function createBurnerWallet(chatId: string) {
  const keypair = Keypair.generate();
  const privateKeyBase58 = bs58.encode(keypair.secretKey);
  const publicKey = keypair.publicKey.toBase58();

  const { encryptedKey, iv } = encryptPrivateKey(privateKeyBase58);

  const wallet = await prisma.degenHunterWallet.upsert({
    where: { chatId },
    update: {
      publicKey,
      encryptedKey,
      iv,
    },
    create: {
      chatId,
      publicKey,
      encryptedKey,
      iv,
    },
  });

  return { publicKey, wallet };
}

export async function getWalletPublicKey(chatId: string): Promise<string | null> {
  const wallet = await prisma.degenHunterWallet.findUnique?.({ where: { chatId } });
  return wallet?.publicKey || null;
}

export async function exportPrivateKey(chatId: string): Promise<string | null> {
  const wallet = await prisma.degenHunterWallet.findUnique?.({ where: { chatId } });
  if (!wallet || !wallet.encryptedKey || !wallet.iv) return null;
  return decryptPrivateKey(wallet.encryptedKey, wallet.iv);
}

export async function getSolBalance(chatId: string): Promise<number> {
  const pubkey = await getWalletPublicKey(chatId);
  if (!pubkey) return 0;
  
  try {
    const balance = await getConnection().getBalance(new (require("@solana/web3.js").PublicKey)(pubkey));
    return balance / 1e9; // lamports to SOL
  } catch (error) {
    console.error(`[solanaTrading] Failed to fetch balance for ${pubkey}:`, error);
    return 0;
  }
}

export async function executeJupiterSwap(
  chatId: string,
  inputMint: string,
  outputMint: string,
  amountInSmallestUnits: number,
  slippageBps: number = 50 // 0.5% default
) {
  const privKeyBase58 = await exportPrivateKey(chatId);
  if (!privKeyBase58) throw new Error("Wallet not found or private key unavailable");
  
  const keypair = Keypair.fromSecretKey(bs58.decode(privKeyBase58));
  
  // 1. Get quote
  const quoteResponse = await fetchWithRetry(
    `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallestUnits}&slippageBps=${slippageBps}`,
    { method: "GET", timeoutMs: 10000, retries: 2 }
  ).then(r => r.json() as Promise<any>);

  if (!quoteResponse || quoteResponse.error) {
    throw new Error(explainJupiterError(quoteResponse));
  }

  // 2. Get swap instruction
  const swapResponse = await fetchWithRetry(
    `${JUPITER_API}/swap`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: keypair.publicKey.toString(),
        wrapAndUnwrapSol: true,
      }),
      timeoutMs: 10000,
      retries: 2,
    }
  ).then(r => r.json() as Promise<any>);

  if (!swapResponse || swapResponse.error || !swapResponse.swapTransaction) {
    throw new Error(`Jupiter swap failed: ${swapResponse?.error || "Unknown error"}`);
  }

  // 3. Deserialize and sign transaction
  const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, "base64");
  let transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  transaction.sign([keypair]);

  // 4. Send transaction
  const rawTransaction = transaction.serialize();
  
  // The system requested to verify without risking real funds, so if balance is 0 this will fail safely at simulation
  const txid = await getConnection().sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 2,
  });

  // Wait for the chain to confirm it. Sending isn't succeeding: a swap can still
  // fail on-chain (slippage, a pulled pool), and callers record a position as
  // soon as this returns — without this, a failed swap left a phantom position.
  const confirmation = await getConnection().confirmTransaction(
    {
      signature: txid,
      blockhash: transaction.message.recentBlockhash,
      lastValidBlockHeight: swapResponse.lastValidBlockHeight,
    },
    "confirmed"
  );
  if (confirmation.value.err) {
    throw new Error(`Swap failed on-chain: ${JSON.stringify(confirmation.value.err)} (tx ${txid})`);
  }

  return { txid, quoteResponse };
}
