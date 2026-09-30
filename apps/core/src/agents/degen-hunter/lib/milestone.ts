import { prisma, filterUnseen, markSeen } from "@max/db";
import { publishAlert } from "../../../lib/notifications";

export async function checkAndFireMilestone(tokenAddress: string, tokenSymbol: string, currentPriceUsd: number) {
  // First find the user's paper trading entry for this token
  const positions = await prisma.degenHunterPosition.findMany({
    where: {
      tokenAddress,
      status: "OPEN",
    },
    orderBy: { createdAt: "asc" }
  });

  if (positions.length === 0) return;

  // Simple entry price based on first buy for the milestone
  const entryPrice = Number(positions[0].entryPriceUsd);
  if (entryPrice <= 0) return;

  const currentMultiple = currentPriceUsd / entryPrice;

  if (currentMultiple >= 2.0) {
    const externalId = `2x-milestone-${tokenAddress}`;
    
    // Check if we already fired this milestone
    const unseen = await filterUnseen("degen-hunter", [externalId]);
    
    if (unseen.length > 0) {
      // It's unseen! Fire the milestone!
      await publishAlert(
        "degen-hunter",
        "2x-milestone",
        `🚀 2× MILESTONE: $${tokenSymbol} has doubled from paper entry!`,
        "info",
        { tokenAddress, multiple: currentMultiple }
      );
      
      // Mark as seen so we don't fire it again
      await markSeen("degen-hunter", [externalId]);
    }
  }
}
