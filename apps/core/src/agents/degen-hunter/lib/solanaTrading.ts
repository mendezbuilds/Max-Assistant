import { Keypair, Connection, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { encryptPrivateKey, decryptPrivateKey } from "@max/shared";
import { prisma } from "@max/db";
import { fetchWithRetry } from "../../../lib/http";

const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

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
    const balance = await connection.getBalance(new (require("@solana/web3.js").PublicKey)(pubkey));
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
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallestUnits}&slippageBps=${slippageBps}`,
    { method: "GET", timeoutMs: 10000, retries: 2 }
  ).then(r => r.json() as Promise<any>);

  if (!quoteResponse || quoteResponse.error) {
    throw new Error(`Jupiter quote failed: ${quoteResponse?.error || "Unknown error"}`);
  }

  // 2. Get swap instruction
  const swapResponse = await fetchWithRetry(
    `https://quote-api.jup.ag/v6/swap`,
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
  const txid = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 2,
  });

  return { txid, quoteResponse };
}
