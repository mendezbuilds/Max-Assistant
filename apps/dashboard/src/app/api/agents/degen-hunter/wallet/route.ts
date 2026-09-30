import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { encryptPrivateKey, verifyPin } from "@max/shared";

const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

/**
 * DELETE /api/agents/degen-hunter/wallet
 * Deletes the burner wallet and creates a new one. Requires PIN.
 * Fails if there are funds or open positions.
 */
export async function DELETE(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { pin: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { pin } = body;
  if (!pin) return NextResponse.json({ error: "PIN is required" }, { status: 400 });

  const user = await prisma.degenHunterUser.findUnique({ where: { chatId } });
  if (!user?.pinHash || !verifyPin(pin, user.pinHash)) {
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 403 });
  }

  const wallet = await prisma.degenHunterWallet.findUnique({ where: { chatId } });
  if (!wallet) return NextResponse.json({ error: "No wallet to delete" }, { status: 404 });

  // Check open positions
  const openPositions = await prisma.degenHunterPosition.count({
    where: { chatId, status: "OPEN" }
  });
  if (openPositions > 0) {
    return NextResponse.json({ error: "Cannot delete wallet with open positions. Sell them first." }, { status: 400 });
  }

  // Check balance (Solana)
  try {
    const lamports = await connection.getBalance(new (require("@solana/web3.js").PublicKey)(wallet.publicKey));
    if (lamports > 0.005 * 1e9) { // allow deleting if only dust remains
      return NextResponse.json({ error: "Cannot delete wallet. Send out your remaining SOL first." }, { status: 400 });
    }
  } catch (err) {
    // If RPC fails, we fail safe
    return NextResponse.json({ error: "Failed to verify balance. Try again later." }, { status: 500 });
  }

  // Generate new wallet
  const newKeypair = Keypair.generate();
  const privateKeyBase58 = bs58.encode(newKeypair.secretKey);
  const publicKey = newKeypair.publicKey.toBase58();
  const { encryptedKey, iv } = encryptPrivateKey(privateKeyBase58);

  await prisma.degenHunterWallet.update({
    where: { chatId },
    data: { publicKey, encryptedKey, iv, balance: 0 }
  });

  // Clear trade history
  await prisma.degenHunterPosition.deleteMany({ where: { chatId } });

  return NextResponse.json({ status: "success", publicKey });
}

export async function GET(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const wallet = await prisma.degenHunterWallet.findUnique({ where: { chatId } });
  if (!wallet) {
    return NextResponse.json({
      status: "not_initialized",
      address: null,
      balanceSol: 0,
      positions: [],
      recentActivity: []
    });
  }

  let balanceSol: number = wallet.balance ? Number(wallet.balance) : 0;
  let balanceSource = "db";
  try {
    const lamports = await connection.getBalance(new (require("@solana/web3.js").PublicKey)(wallet.publicKey));
    balanceSol = lamports / 1e9;
    balanceSource = "solana_rpc";
  } catch (err) {
    console.error("Failed to fetch balance from RPC", err);
  }

  const positions = await prisma.degenHunterPosition.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" }
  });

  const recentActivity = positions.map(p => ({
    id: p.id,
    tokenAddress: p.tokenAddress,
    tokenSymbol: p.tokenSymbol,
    amountSOL: p.amountSOL,
    entryPriceUsd: p.entryPriceUsd,
    status: p.status,
    timestamp: p.createdAt.toISOString()
  }));

  return NextResponse.json({ 
    status: balanceSol > 0.005 ? "funded" : "unfunded",
    address: wallet.publicKey, 
    balanceSol,
    balanceSource,
    positions,
    recentActivity
  });
}
