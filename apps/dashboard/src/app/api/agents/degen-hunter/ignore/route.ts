import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";

/** GET /api/agents/degen-hunter/ignore — addresses the owner has ignored (same table the Telegram bot's Ignore button writes) */
export async function GET() {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "identity_not_mapped" }, { status: 401 });
  const rows = await prisma.degenHunterIgnoredToken.findMany({ where: { chatId }, select: { tokenAddress: true } });
  return NextResponse.json({ ignored: rows.map((r) => r.tokenAddress) });
}

/** POST /api/agents/degen-hunter/ignore — body { tokenAddress }. Idempotent. */
export async function POST(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "identity_not_mapped" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { tokenAddress?: string };
  if (!body.tokenAddress) return NextResponse.json({ error: "tokenAddress is required" }, { status: 400 });

  await prisma.degenHunterIgnoredToken.upsert({
    where: { chatId_tokenAddress: { chatId, tokenAddress: body.tokenAddress } },
    create: { chatId, tokenAddress: body.tokenAddress },
    update: {},
  });
  return NextResponse.json({ status: "ignored" });
}
