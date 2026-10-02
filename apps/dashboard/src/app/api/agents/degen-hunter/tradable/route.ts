import { NextRequest, NextResponse } from "next/server";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";
import { checkTradableMany } from "@/lib/jupiter";

/**
 * GET /api/agents/degen-hunter/tradable?mints=<a>,<b>,...
 *
 * Whether Jupiter can currently route a buy of each token (max 20). Owner only,
 * so the dashboard can't be used as an open proxy to Jupiter.
 */
export async function GET(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mints = (req.nextUrl.searchParams.get("mints") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)); // base58 addresses only
  if (mints.length === 0) return NextResponse.json({ tradable: {} });

  return NextResponse.json({ tradable: await checkTradableMany(mints) });
}
