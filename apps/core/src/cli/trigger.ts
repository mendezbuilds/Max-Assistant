// Manually runs one agent immediately, in its own short-lived process — does
// NOT require apps/core's long-running dev/prod process to be up, since it
// talks to the same shared DB directly. Usage: npm run trigger:job-scout
// (or, generically: npm run trigger --workspace=@max/core -- <agent-key>)
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") });
process.env.MAX_DB_FILE ??= path.resolve(__dirname, "..", "..", "..", "..", "data", "max.db");

import { prisma, logActivity } from "@max/db";
import { AGENT_RUNNERS } from "../agents/registry";
import { createBot } from "../telegram";

async function main() {
  const agentKey = process.argv[2];
  const knownAgents = Object.keys(AGENT_RUNNERS).join(", ");

  if (!agentKey || !AGENT_RUNNERS[agentKey]) {
    console.error(agentKey ? `Unknown agent "${agentKey}".` : "Usage: npm run trigger:<agent-key>");
    console.error(`Known agents: ${knownAgents}`);
    process.exit(1);
  }

  // createBot() only constructs the API client (so notify()/notifyPublic()
  // inside the agent's run can actually send) — it deliberately does NOT
  // start long-polling (that's startBot(), for the real core process only).
  // Without this, this standalone script would silently no-op every send —
  // exactly the bug an earlier version of this file had.
  if (process.env.TELEGRAM_BOT_TOKEN) {
    createBot(process.env.TELEGRAM_BOT_TOKEN);
  } else {
    console.warn("[trigger] TELEGRAM_BOT_TOKEN not set — this run will not actually send anything.");
  }

  const agent = await prisma.agent.findUnique({ where: { key: agentKey } });
  if (!agent?.enabled) {
    console.error(
      `"${agentKey}" is disabled — enable it on the dashboard first, then re-run this.`
    );
    process.exit(1);
  }

  console.log(`Running ${agentKey}...`);
  // Logged under "system" — see the matching comment in the dashboard's
  // trigger route for why this can't be logged under agentKey itself.
  await logActivity("system", "info", `Manual run triggered for ${agentKey} (CLI)`);
  await AGENT_RUNNERS[agentKey]();
  console.log("Done — check the dashboard's activity feed for the result.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
