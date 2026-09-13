import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@max/db";

/**
 * Toggling an agent here only flips the DB row. apps/core is the process
 * that actually owns scheduling agents — it checks `enabled` before running
 * one — so this route deliberately does no more than write state + log it.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const body = await req.json().catch(() => ({}));
  const agent = await prisma.agent.findUnique({ where: { key } });

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const enabled = typeof body.enabled === "boolean" ? body.enabled : !agent.enabled;

  const updated = await prisma.agent.update({
    where: { key },
    data: { enabled, status: enabled ? "idle" : "disabled" },
  });

  await logActivity(
    "system",
    "info",
    `${enabled ? "Enabled" : "Disabled"} ${agent.name} from the dashboard`
  );

  return NextResponse.json(updated);
}
