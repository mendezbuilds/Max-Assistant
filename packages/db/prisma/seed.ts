import { prisma } from "../src/index";
import { AGENT_REGISTRY } from "../../shared/src/agents.config";

/**
 * Upserts one Agent row per entry in the shared registry. Safe to re-run any
 * time the roster changes (new agent added, description edited) — it never
 * touches enabled/status/lastAction* on existing rows, so live state survives
 * a re-seed.
 */
async function main() {
  for (const def of AGENT_REGISTRY) {
    await prisma.agent.upsert({
      where: { key: def.key },
      update: {
        name: def.name,
        icon: def.icon,
        description: def.description,
        phase: def.phase,
      },
      create: {
        key: def.key,
        name: def.name,
        icon: def.icon,
        description: def.description,
        phase: def.phase,
        enabled: false,
        status: "disabled",
      },
    });
  }

  await prisma.activityLog.create({
    data: {
      agentKey: "system",
      level: "info",
      message: `Seeded ${AGENT_REGISTRY.length} agents from the roster`,
    },
  });

  console.log(`Seeded ${AGENT_REGISTRY.length} agents.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
