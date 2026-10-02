import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { decryptPrivateKey, verifyPinWithLockout } from "@max/shared";
import { pinRejectionResponse } from "@/lib/degen-pin";

const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");
// Unlike /trade (which caps at 1.0 SOL per swap), this route had NO cap at
// all — a verified PIN could send the wallet's entire balance in one call.
// Same limit as /trade for consistency; raise deliberately if ever needed,
// not by omission.
const HARD_SEND_LIMIT_SOL = 1.0;

/**
 * POST /api/agents/degen-hunter/wallet/send
 * Sends SOL to a destination address.
 * Body: { destination: string, amount: string, pin: string }
 */
export async function POST(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { destination: string; amount: string; pin: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { destination, amount, pin } = body;
  if (!destination || !amount || !pin) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  let destPubkey: PublicKey;
  try {
    destPubkey = new PublicKey(destination);
  } catch {
    return NextResponse.json({ error: "Invalid destination address" }, { status: 400 });
  }

  const solAmount = parseFloat(amount);
  if (isNaN(solAmount) || solAmount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  if (solAmount > HARD_SEND_LIMIT_SOL) {
    return NextResponse.json(
      { error: `Hard send limit is ${HARD_SEND_LIMIT_SOL} SOL per transaction` },
      { status: 400 }
    );
  }

  const pinCheck = await verifyPinWithLockout(chatId, pin);
  if (!pinCheck.ok) {
    return pinRejectionResponse(pinCheck);
  }

  const wallet = await prisma.degenHunterWallet.findUnique({ where: { chatId } });
  if (!wallet?.publicKey || !wallet.encryptedKey || !wallet.iv) {
    return NextResponse.json({ error: "No wallet found" }, { status: 404 });
  }

  const privKeyBase58 = decryptPrivateKey(wallet.encryptedKey, wallet.iv);
  if (!privKeyBase58) {
    return NextResponse.json({ error: "Failed to decrypt wallet" }, { status: 500 });
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(privKeyBase58));

  const lamports = Math.floor(solAmount * 1e9);

  try {
    const currentBalance = await connection.getBalance(keypair.publicKey);
    if (currentBalance < lamports + 5000) {
      await recordWalletEvent("withdraw_failed", solAmount, "Insufficient balance");
      return NextResponse.json({ error: "Insufficient balance (including fees)" }, { status: 400 });
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: destPubkey,
        lamports,
      })
    );

    const txid = await sendAndConfirmTransaction(connection, transaction, [keypair], {
      commitment: "confirmed"
    });

    await recordWalletEvent("withdraw", solAmount, `to ${destination.slice(0, 4)}…${destination.slice(-4)}`);
    return NextResponse.json({ status: "success", txid });
  } catch (err: any) {
    console.error("[wallet/send] Error:", err.message);
    await recordWalletEvent("withdraw_failed", solAmount, String(err.message).slice(0, 120));
    return NextResponse.json({ error: `Transaction failed: ${err.message}` }, { status: 400 });
  }
}

/**
 * Persists a withdrawal (or failed attempt) so the wallet's Recent Activity
 * can show it — positions only capture buys/sells. Records amount and a short
 * detail only: never keys, PINs, or the full destination address. A logging
 * failure must never mask the real result of the send.
 */
async function recordWalletEvent(kind: "withdraw" | "withdraw_failed", amountSOL: number, detail: string) {
  const label = kind === "withdraw" ? "Withdraw" : "Withdraw failed";
  await logActivity("degen-hunter", kind === "withdraw" ? "info" : "warn", `${label}: ${amountSOL} SOL (${detail})`, {
    kind,
    label,
    detail,
    amountSOL,
  }).catch(() => {});
}
