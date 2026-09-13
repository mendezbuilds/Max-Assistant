import { NextResponse } from "next/server";
import { prisma } from "@max/db";

/** All agents, for the orbit view's periodic client-side refresh — a full page reload/`router.refresh()` would restart every CSS animation, so the orbit polls this instead. */
export async function GET() {
  const agents = await prisma.agent.findMany({ orderBy: [{ phase: "asc" }, { name: "asc" }] });
  return NextResponse.json(agents);
}
