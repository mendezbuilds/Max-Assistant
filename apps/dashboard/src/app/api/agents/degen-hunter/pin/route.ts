import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { resolveDegenOwnerChatId } from "@/lib/degen-identity";
import { hashPin, verifyPinWithLockout } from "@max/shared";
import { pinRejectionResponse } from "@/lib/degen-pin";

/**
 * POST /api/agents/degen-hunter/pin
 * Body: { oldPin?: string, newPin: string }
 */
export async function POST(req: NextRequest) {
  const chatId = await resolveDegenOwnerChatId();
  if (!chatId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { oldPin?: string; newPin: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { oldPin, newPin } = body;
  if (!newPin || newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
    return NextResponse.json({ error: "New PIN must be 4-8 digits" }, { status: 400 });
  }

  const user = await prisma.degenHunterUser.findUnique({ where: { chatId } });

  if (user?.pinHash) {
    if (!oldPin) {
      return NextResponse.json({ error: "Current PIN is required to change it" }, { status: 400 });
    }
    const pinCheck = await verifyPinWithLockout(chatId, oldPin);
    if (!pinCheck.ok) {
      return pinRejectionResponse(pinCheck);
    }
  }

  const newPinHash = hashPin(newPin);

  await prisma.degenHunterUser.upsert({
    where: { chatId },
    update: { pinHash: newPinHash },
    create: { chatId, pinHash: newPinHash, alertsEnabled: true }
  });

  return NextResponse.json({ status: "success" });
}
