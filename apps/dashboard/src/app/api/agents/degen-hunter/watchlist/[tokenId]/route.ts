import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";

/** DELETE /api/agents/degen-hunter/watchlist/[tokenId] — remove a token from watchlist */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) {
    return NextResponse.json(
      {
        error: "identity_not_mapped",
        message: "DEGEN_OWNER_CHAT_ID is not configured.",
      },
      { status: 401 }
    );
  }

  const resolvedParams = await params;
  const tokenAddress = decodeURIComponent(resolvedParams.tokenId).trim();
  if (!tokenAddress) {
    return NextResponse.json({ error: "tokenId is required" }, { status: 400 });
  }

  try {
    await prisma.degenHunterWatchlist.delete({
      where: { chatId_tokenAddress: { chatId, tokenAddress } },
    });

    return NextResponse.json({ success: true, tokenAddress });
  } catch (error: any) {
    // Prisma throws P2025 if the record doesn't exist — treat as success
    if (error?.code === "P2025") {
      return NextResponse.json({ success: true, tokenAddress, alreadyRemoved: true });
    }
    console.error("[watchlist DELETE]", error);
    return NextResponse.json({ error: "Failed to remove from watchlist" }, { status: 500 });
  }
}
